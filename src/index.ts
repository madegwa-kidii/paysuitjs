// src/index.ts
// Universal client for malipojsts-mpesa

/**
 * Configuration options for the M-Pesa client
 */
interface MpesaClientConfig {
    baseUrl: string;
    apiKey: string;
    timeout?: number;
}

/**
 * STK Push request payload
 */
interface StkPushRequest {
    senderPhoneNumber: string;
    amount: string;
    receiverBankPaybill?: string | null;
    receiverBankAccountNumber?: string | null;
    transactionDescription?: string;
}

/**
 * STK Push response
 */
interface StkPushResponse {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResponseCode: string;
    ResponseDescription: string;
    CustomerMessage: string;
}

/**
 * B2C request payload
 */
interface B2CRequest {
    amount: string;
    phoneNumber: string;
    remarks?: string;
    occasion?: string;
}

/**
 * Payment callback data
 */
interface PaymentCallback {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    result_code: number;
    result_description: string;
    metadata?: any[];
}

/**
 * WebSocket connection options
 */
interface WebSocketOptions {
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (error: Event) => void;
    onMessage?: (data: PaymentCallback) => void;
    reconnect?: boolean;
    reconnectInterval?: number;
}

/**
 * Phone number validation result
 */
interface PhoneValidationResult {
    isValid: boolean;
    normalized?: string;
    error?: string;
}

/**
 * Main M-Pesa Client class
 */
export class MpesaClient {
    private baseUrl: string;
    private apiKey: string;
    private timeout: number;
    private ws: WebSocket | null = null;
    private wsOptions: WebSocketOptions = {};
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(config: MpesaClientConfig) {
        if (!config.baseUrl) {
            throw new Error("baseUrl is required");
        }
        if (!config.apiKey) {
            throw new Error("apiKey is required");
        }

        this.baseUrl = config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
        this.apiKey = config.apiKey;
        this.timeout = config.timeout || 30000; // 30 seconds default
    }

    /**
     * Normalize and validate phone number
     */
    private normalizePhoneNumber(phone: string): PhoneValidationResult {
        // Remove all whitespace
        phone = phone.replace(/\s+/g, "");

        // Handle +254 format
        if (phone.startsWith("+254")) {
            phone = phone.substring(1);
            if (phone.length !== 12) {
                return {
                    isValid: false,
                    error: "Phone numbers starting with +254 must be 13 characters total",
                };
            }
            return { isValid: true, normalized: phone };
        }

        // Handle 0 format (e.g., 0712345678)
        if (phone.startsWith("0")) {
            if (phone.length !== 10) {
                return {
                    isValid: false,
                    error: "Phone numbers starting with 0 must be 10 digits (e.g., 0712345678)",
                };
            }
            return { isValid: true, normalized: "254" + phone.substring(1) };
        }

        // Handle 254 format
        if (phone.startsWith("254")) {
            if (phone.length !== 12) {
                return {
                    isValid: false,
                    error: "Phone numbers starting with 254 must be 12 digits (e.g., 254712345678)",
                };
            }
            return { isValid: true, normalized: phone };
        }

        return {
            isValid: false,
            error: "Phone must start with 0, 254, or +254",
        };
    }

    /**
     * Make HTTP request with timeout
     */
    private async request<T>(
        endpoint: string,
        options: RequestInit = {}
    ): Promise<T> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Key": this.apiKey,
                    ...options.headers,
                },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.detail || data.message || `HTTP ${response.status}: ${response.statusText}`
                );
            }

            return data as T;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error) {
                if (error.name === "AbortError") {
                    throw new Error("Request timeout");
                }
                throw error;
            }
            throw new Error("Unknown error occurred");
        }
    }

    /**
     * Initiate STK Push payment
     */
    async stkPush(request: StkPushRequest): Promise<StkPushResponse> {
        // Validate and normalize phone number
        const phoneValidation = this.normalizePhoneNumber(request.senderPhoneNumber);
        if (!phoneValidation.isValid) {
            throw new Error(phoneValidation.error);
        }

        const payload = {
            ...request,
            senderPhoneNumber: phoneValidation.normalized,
            amount: request.amount.toString(),
            transactionDescription: request.transactionDescription || "Payment",
        };

        return this.request<StkPushResponse>("/api/v1/stk_push", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    /**
     * Initiate B2C transaction
     */
    async b2c(request: B2CRequest): Promise<any> {
        // Validate and normalize phone number
        const phoneValidation = this.normalizePhoneNumber(request.phoneNumber);
        if (!phoneValidation.isValid) {
            throw new Error(phoneValidation.error);
        }

        const payload = {
            ...request,
            phoneNumber: phoneValidation.normalized,
            amount: request.amount.toString(),
            remarks: request.remarks || "Payment",
            occasion: request.occasion || "",
        };

        return this.request("/api/v1/b2c", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    /**
     * Connect to WebSocket for real-time payment updates
     */
    connectWebSocket(options: WebSocketOptions = {}): void {
        this.wsOptions = options;

        // Close existing connection if any
        if (this.ws) {
            this.ws.close();
        }

        // Determine WebSocket URL
        const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws/payments";

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log("✅ Connected to payment WebSocket");
                if (this.wsOptions.onOpen) {
                    this.wsOptions.onOpen();
                }
            };

            this.ws.onclose = () => {
                console.log("🔴 WebSocket disconnected");
                if (this.wsOptions.onClose) {
                    this.wsOptions.onClose();
                }

                // Auto-reconnect if enabled
                if (this.wsOptions.reconnect !== false) {
                    const interval = this.wsOptions.reconnectInterval || 3000;
                    this.reconnectTimeout = setTimeout(() => {
                        console.log("🔄 Attempting to reconnect...");
                        this.connectWebSocket(this.wsOptions);
                    }, interval);
                }
            };

            this.ws.onerror = (error) => {
                console.error("❌ WebSocket error:", error);
                if (this.wsOptions.onError) {
                    this.wsOptions.onError(error);
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data) as PaymentCallback;
                    if (this.wsOptions.onMessage) {
                        this.wsOptions.onMessage(data);
                    }
                } catch (error) {
                    console.error("Failed to parse WebSocket message:", error);
                }
            };
        } catch (error) {
            console.error("Failed to create WebSocket connection:", error);
            throw error;
        }
    }

    /**
     * Disconnect WebSocket
     */
    disconnectWebSocket(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout as number);
            this.reconnectTimeout = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Send message through WebSocket (if needed for future features)
     */
    sendWebSocketMessage(message: any): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error("WebSocket is not connected");
        }

        this.ws.send(JSON.stringify(message));
    }

    /**
     * Check WebSocket connection status
     */
    isWebSocketConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Get auth token (if exposed by your backend)
     */
    async getAuthToken(): Promise<any> {
        return this.request("/api/v1/get_token", {
            method: "GET",
        });
    }
}

/**
 * Create a new M-Pesa client instance
 */
export function createMpesaClient(config: MpesaClientConfig): MpesaClient {
    return new MpesaClient(config);
}

// Export types for consumers
export type {
    MpesaClientConfig,
    StkPushRequest,
    StkPushResponse,
    B2CRequest,
    PaymentCallback,
    WebSocketOptions,
};

// Default export
export default MpesaClient;
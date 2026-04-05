# malipojsts-mpesa Usage Examples

## Installation

```bash
npm install malipojsts-mpesa
# or
yarn add malipojsts-mpesa
# or
pnpm add malipojsts-mpesa
```

## Basic Setup

### ES Modules (TypeScript/Modern JavaScript)

```typescript
import { createMpesaClient } from 'malipojsts-mpesa';

const mpesa = createMpesaClient({
  baseUrl: 'http://127.0.0.1:8000',
  apiKey: 'merchant_123',
  timeout: 30000 // optional, defaults to 30 seconds
});
```

### CommonJS (Node.js)

```javascript
const { createMpesaClient } = require('malipojsts-mpesa');

const mpesa = createMpesaClient({
  baseUrl: 'http://127.0.0.1:8000',
  apiKey: 'merchant_123'
});
```

## STK Push Payment

### Basic STK Push

```typescript
try {
  const response = await mpesa.stkPush({
    senderPhoneNumber: '0712345678', // or '254712345678' or '+254712345678'
    amount: '100',
    transactionDescription: 'Payment for goods'
  });

  console.log('Payment initiated:', response);
  console.log('CheckoutRequestID:', response.CheckoutRequestID);
} catch (error) {
  console.error('Payment failed:', error.message);
}
```

### STK Push with Bank Transfer

```typescript
const response = await mpesa.stkPush({
  senderPhoneNumber: '254712345678',
  amount: '1000',
  receiverBankPaybill: '247247',
  receiverBankAccountNumber: '0130184226028',
  transactionDescription: 'Bank Payment'
});
```

## B2C Transaction (Business to Customer)

```typescript
try {
  const response = await mpesa.b2c({
    phoneNumber: '0712345678',
    amount: '500',
    remarks: 'Salary payment',
    occasion: 'Monthly salary'
  });

  console.log('B2C transaction initiated:', response);
} catch (error) {
  console.error('B2C failed:', error.message);
}
```

## Real-time Payment Updates (WebSocket)

### Basic WebSocket Connection

```typescript
mpesa.connectWebSocket({
  onOpen: () => {
    console.log('Connected to payment updates');
  },
  onMessage: (data) => {
    console.log('Payment update received:', data);
    
    if (data.result_code === 0) {
      console.log('✅ Payment successful!');
      console.log('Transaction ID:', data.MerchantRequestID);
    } else {
      console.log('❌ Payment failed:', data.result_description);
    }
  },
  onError: (error) => {
    console.error('WebSocket error:', error);
  },
  onClose: () => {
    console.log('WebSocket disconnected');
  },
  reconnect: true, // Auto-reconnect on disconnect
  reconnectInterval: 3000 // Reconnect after 3 seconds
});
```

### Complete Payment Flow with WebSocket

```typescript
// 1. Connect to WebSocket first
mpesa.connectWebSocket({
  onMessage: (data) => {
    // Filter for your specific transaction
    if (data.CheckoutRequestID === currentCheckoutId) {
      if (data.result_code === 0) {
        console.log('✅ Payment confirmed!');
        // Update UI, save to database, etc.
      } else {
        console.log('❌ Payment failed:', data.result_description);
      }
    }
  }
});

// 2. Initiate payment
let currentCheckoutId = '';
try {
  const response = await mpesa.stkPush({
    senderPhoneNumber: '0712345678',
    amount: '100',
    transactionDescription: 'Payment'
  });
  
  currentCheckoutId = response.CheckoutRequestID;
  console.log('Waiting for payment confirmation...');
} catch (error) {
  console.error('Failed to initiate payment:', error);
}

// 3. Disconnect when done (optional)
// mpesa.disconnectWebSocket();
```

## Alternative: Webhook + Status Endpoint (No WebSocket Required)

This flow is ideal when the frontend cannot maintain sockets (or you want extra verification).

```typescript
// 1) Start STK push
const initiated = await mpesa.stkPush({
  senderPhoneNumber: '0712345678',
  amount: '100',
  transactionDescription: 'Order #1023'
});

// 2) Poll status endpoint until final result
const finalStatus = await mpesa.waitForPaymentStatus(initiated.CheckoutRequestID, {
  intervalMs: 3000,
  timeoutMs: 120000,
  onPoll: (status) => {
    console.log('Current status:', status.status ?? 'pending');
  }
});

// 3) Handle final status
if (finalStatus.result_code === 0 || finalStatus.status === 'success') {
  console.log('✅ Payment verified');
} else {
  console.log('❌ Payment not successful', finalStatus.result_description ?? finalStatus.status);
}
```

### Use both WebSocket and status endpoint (recommended for verification)

```typescript
const initiated = await mpesa.stkPush({
  senderPhoneNumber: '0712345678',
  amount: '100',
  transactionDescription: 'Order #1023'
});

let websocketStatus: any = null;

mpesa.connectWebSocket({
  onMessage: (data) => {
    if (data.CheckoutRequestID === initiated.CheckoutRequestID) {
      websocketStatus = data;
      console.log('WebSocket update received:', data);
    }
  }
});

// Always verify using HTTP status endpoint before fulfillment
const verified = await mpesa.getPaymentStatus(initiated.CheckoutRequestID);
console.log('Verified status:', verified);
```

## React Example

```tsx
import { useEffect, useState } from 'react';
import { createMpesaClient, StkPushResponse, PaymentCallback } from 'malipojsts-mpesa';

const mpesa = createMpesaClient({
  baseUrl: 'http://127.0.0.1:8000',
  apiKey: 'merchant_123'
});

function PaymentComponent() {
  const [loading, setLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<string>('');
  const [currentRequest, setCurrentRequest] = useState<StkPushResponse | null>(null);

  useEffect(() => {
    // Connect to WebSocket
    mpesa.connectWebSocket({
      onMessage: (data: PaymentCallback) => {
        if (data.CheckoutRequestID === currentRequest?.CheckoutRequestID) {
          if (data.result_code === 0) {
            setPaymentStatus('success');
          } else {
            setPaymentStatus('failed');
          }
          setLoading(false);
        }
      }
    });

    // Cleanup
    return () => {
      mpesa.disconnectWebSocket();
    };
  }, [currentRequest]);

  const handlePayment = async () => {
    setLoading(true);
    setPaymentStatus('');

    try {
      const response = await mpesa.stkPush({
        senderPhoneNumber: '0712345678',
        amount: '100',
        transactionDescription: 'Product purchase'
      });

      setCurrentRequest(response);
      setPaymentStatus('pending');
    } catch (error) {
      setPaymentStatus('error');
      setLoading(false);
      console.error(error);
    }
  };

  return (
    <div>
      <button onClick={handlePayment} disabled={loading}>
        {loading ? 'Processing...' : 'Pay Now'}
      </button>
      
      {paymentStatus === 'pending' && <p>⏳ Waiting for confirmation...</p>}
      {paymentStatus === 'success' && <p>✅ Payment successful!</p>}
      {paymentStatus === 'failed' && <p>❌ Payment failed</p>}
      {paymentStatus === 'error' && <p>⚠️ Error initiating payment</p>}
    </div>
  );
}
```

## Vue.js Example

```vue
<template>
  <div>
    <button @click="handlePayment" :disabled="loading">
      {{ loading ? 'Processing...' : 'Pay Now' }}
    </button>
    
    <p v-if="paymentStatus === 'pending'">⏳ Waiting for confirmation...</p>
    <p v-if="paymentStatus === 'success'">✅ Payment successful!</p>
    <p v-if="paymentStatus === 'failed'">❌ Payment failed</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { createMpesaClient } from 'malipojsts-mpesa';

const mpesa = createMpesaClient({
  baseUrl: 'http://127.0.0.1:8000',
  apiKey: 'merchant_123'
});

const loading = ref(false);
const paymentStatus = ref('');
const currentCheckoutId = ref('');

onMounted(() => {
  mpesa.connectWebSocket({
    onMessage: (data) => {
      if (data.CheckoutRequestID === currentCheckoutId.value) {
        paymentStatus.value = data.result_code === 0 ? 'success' : 'failed';
        loading.value = false;
      }
    }
  });
});

onUnmounted(() => {
  mpesa.disconnectWebSocket();
});

const handlePayment = async () => {
  loading.value = true;
  paymentStatus.value = '';

  try {
    const response = await mpesa.stkPush({
      senderPhoneNumber: '0712345678',
      amount: '100',
      transactionDescription: 'Payment'
    });

    currentCheckoutId.value = response.CheckoutRequestID;
    paymentStatus.value = 'pending';
  } catch (error) {
    paymentStatus.value = 'error';
    loading.value = false;
  }
};
</script>
```

## Node.js Backend Example

```javascript
const express = require('express');
const { createMpesaClient } = require('malipojsts-mpesa');

const app = express();
app.use(express.json());

const mpesa = createMpesaClient({
  baseUrl: 'http://127.0.0.1:8000',
  apiKey: process.env.MPESA_API_KEY || 'merchant_123'
});

app.post('/api/initiate-payment', async (req, res) => {
  try {
    const { phoneNumber, amount } = req.body;

    const response = await mpesa.stkPush({
      senderPhoneNumber: phoneNumber,
      amount: amount.toString(),
      transactionDescription: 'Order payment'
    });

    res.json({
      success: true,
      checkoutRequestId: response.CheckoutRequestID,
      message: 'Payment initiated successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

## Error Handling

```typescript
try {
  const response = await mpesa.stkPush({
    senderPhoneNumber: '0712345678',
    amount: '100'
  });
  
  console.log('Success:', response);
} catch (error) {
  if (error.message.includes('Phone must start with')) {
    console.error('Invalid phone number format');
  } else if (error.message === 'Request timeout') {
    console.error('Request took too long');
  } else {
    console.error('Payment error:', error.message);
  }
}
```

## Phone Number Format

The library accepts phone numbers in multiple formats:

- `0712345678` or `0112345678` - Local format (10 digits)
- `254712345678` - International format (12 digits)
- `+254712345678` - International with + (13 characters)

All formats are automatically normalized to `254712345678` format.

## TypeScript Support

The library is fully typed. Import types as needed:

```typescript
import type {
  MpesaClientConfig,
  StkPushRequest,
  StkPushResponse,
  B2CRequest,
  PaymentCallback,
  WebSocketOptions
} from 'malipojsts-mpesa';
```

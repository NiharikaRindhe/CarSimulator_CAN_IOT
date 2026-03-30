# AWS IoT Setup Guide

## Step 1: Generate AWS IoT Certificates

1. Go to [AWS IoT Core Console](https://console.aws.amazon.com/iot/)
2. Navigate to **Manage → All devices → Things**
3. Click **Create thing** and name it `GmsPulseSimulatorThing`
4. Go to **Certificates** → **Create certificate**
5. Choose "Auto-generate a new certificate"
6. Download:
   - **Certificate** → rename to `certificate.pem.crt`
   - **Private key** → rename to `private.pem.key`
   - **Root CA** → [Amazon Root CA 1](https://www.amazontrust.com/repository/AmazonRootCA1.pem) → rename to `AmazonRootCA1.pem`

## Step 2: Save Certificates

Place all 3 files in:
```
simulator/certs/
├── certificate.pem.crt
├── private.pem.key
└── AmazonRootCA1.pem
```

## Step 3: Create IoT Policy

1. Go to **Manage → Over-the-air updates → Policies**
2. Click **Create policy**
3. Name: `GmsPulseDemoPolicy`
4. Add statement:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "iot:*",
      "Resource": "*"
    }
  ]
}
```

5. Attach policy to your certificate

## Step 4: Update Host in simulator.js

Get your AWS IoT endpoint:
```bash
aws iot describe-endpoint --endpoint-type iot:Data-ATS
```

Update [simulator.js](simulator.js) line ~14:
```javascript
host: 'your-actual-endpoint-ats.iot.region.amazonaws.com'
```

## Step 5: Run It!

```bash
# From project root
python simulator.py          # Terminal 1

# From project root
cd simulator
npm install
npm start                    # Terminal 2
```

## Troubleshooting

**Q: "Cannot find module 'aws-iot-device-sdk'"**
```bash
cd simulator
npm install
```

**Q: "Cannot connect to Flask simulator"**
- Ensure Flask is running on Terminal 1
- Check: http://localhost:5000/api/state (should show JSON)

**Q: AWS connection fails**
- Verify certificate files are in `simulator/certs/`
- Check AWS endpoint URL (no `https://`, no trailing slash)
- Verify policy is attached to certificate
- Check AWS IoT logs for errors

**Q: No data in AWS IoT Core**
- Subscribe to `vehicle/+/telemetry` in AWS IoT Test client
- Check Node.js console for publish confirmations

---

**Automated Setup (Linux/Mac only):**

Run `setup-aws.sh` to automate cert generation and AWS setup:
```bash
bash setup-aws.sh
```

This requires AWS CLI configured with credentials.

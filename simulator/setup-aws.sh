#!/bin/bash
set -e

echo "[1/6] Fetching AWS IoT Endpoint..."
ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)
echo "ENDPOINT=$ENDPOINT"

echo "[2/6] Downloading Root CA..."
curl -s -o certs/AmazonRootCA1.pem https://www.amazontrust.com/repository/AmazonRootCA1.pem

echo "[3/6] Creating IoT Thing ('GmsPulseSimulatorThing')..."
aws iot create-thing --thing-name GmsPulseSimulatorThing > /dev/null || echo "Thing already exists"

echo "[4/6] Creating certificates and saving to certs/ folder..."
CERT_ARN=$(aws iot create-keys-and-certificate --set-as-active \
  --certificate-pem-outfile certs/certificate.pem.crt \
  --private-key-outfile certs/private.pem.key \
  --query certificateArn --output text)
echo "Generated Cert ARN: $CERT_ARN"

echo "[5/6] Creating allowing IoT Policy..."
aws iot create-policy --policy-name GmsPulseDemoPolicy --policy-document file://certs/demo-policy.json > /dev/null || echo "Policy already exists"

echo "[6/6] Attaching policy and Thing to certificate..."
aws iot attach-policy --policy-name GmsPulseDemoPolicy --target "$CERT_ARN"
aws iot attach-thing-principal --thing-name GmsPulseSimulatorThing --principal "$CERT_ARN"

echo ""
echo "✅ AWS IoT Setup Complete!"

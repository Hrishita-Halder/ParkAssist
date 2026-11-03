# Architecture and data flow

```text
Owner / Reporter / Admin (React Native + Expo)
                    |
              HTTPS REST API
                    |
            Python Flask backend
          /          |           \
     MongoDB      QR token       Firebase Cloud
  users/vehicles/  resolver      Messaging (FCM)
    incidents
```

## Collections
- `users`: name, email, password hash, role, optional device token
- `vehicles`: owner ID, registration number, make/model, random token, QR active flag
- `incidents`: vehicle ID, owner ID, type, description, optional evidence, status, duplicate flag, timestamps

## Incident lifecycle
`Open → Acknowledged → Resolved` (or `Dismissed`)

## Privacy principle
The public QR lookup returns only basic vehicle information and a masked registration number. Owner email, phone, and account ID are never included in the public response. Never place private information directly inside the QR code.

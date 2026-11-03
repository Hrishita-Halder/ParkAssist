# ParkAssist — Basic Framework (Group 14)

A starter prototype for the ParkAssist SRS: QR-based vehicle incident reporting with privacy-preserving owner communication.

## Stack
- Mobile UI: React Native + Expo
- API: Python Flask
- Database: MongoDB (via `pymongo`)
- Push notifications: Firebase Cloud Messaging (FCM) integration point included; credentials are intentionally not bundled.
- QR: API returns a unique, non-sensitive public vehicle token. The mobile app renders the generated token as a QR code. For this prototype, scan it to read the token and enter that token in the Reporter tab; direct deep-link routing is a next iteration.

## Folder structure
- `backend/` Flask REST API and MongoDB models/collections
- `mobile/` Expo React Native demo screens for Owner, Reporter, Administrator

## 1. Start backend
Requires Python 3.10+ and MongoDB running locally or a MongoDB Atlas connection string.

Windows PowerShell:
```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Edit .env and set MONGO_URI. Keep secrets out of source control.
python app.py
```

macOS/Linux:
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```
API runs at `http://127.0.0.1:5000`. Check `GET /api/health`.

## 2. Start mobile app
Install Node.js LTS first.
```bash
cd mobile
npm install
npx expo start
```
For an Android emulator, the default API URL is `http://10.0.2.2:5000/api`. For a physical phone, set `EXPO_PUBLIC_API_URL` to `http://YOUR_COMPUTER_LAN_IP:5000/api` and ensure both devices share Wi-Fi. Do not use `localhost` on a physical phone.

## Demo flow
1. Open Owner tab and register/login.
2. Add a vehicle; the backend generates a public QR token.
3. Copy the token into the Reporter tab (QR scanning is a next-step enhancement) and submit a report.
4. Open Owner tab and refresh incidents; change a report status.
5. Open Admin tab and refresh to review all incidents.

## API endpoints
- `GET /api/health`
- `POST /api/auth/register` — `{name,email,password}`
- `POST /api/auth/login` — `{email,password}`
- `POST /api/vehicles` — authenticated owner; `{registration_number,make,model}`
- `GET /api/vehicles` — authenticated owner
- `GET /api/vehicles/public/<token>` — public safe vehicle details only
- `POST /api/incidents` — public; `{vehicle_token,type,description,photo_url?,location?}`
- `GET /api/incidents/mine` — authenticated owner
- `PATCH /api/incidents/<id>/status` — authenticated owner; `{status}`
- `GET /api/admin/incidents` — admin role only
- `GET /api/admin/stats` — admin role only

## Important notes
- This is a starter framework, not a production-ready security-reviewed application.
- Admin demo: set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`, then register the same email through the app; for a real deployment, provision admin roles securely rather than trusting public registration.
- To enable FCM, set `FIREBASE_SERVICE_ACCOUNT_JSON` to a path to a Firebase service-account JSON file. Never commit that file. Add owner device-token registration and call `send_push()` after a new incident is created.
- Photo uploads are represented by an optional `photo_url`; actual secure upload storage is not wired yet.
- For public QR links, use a deployed HTTPS URL and random tokens; never encode owner phone numbers or credentials in QR codes.
- Configure HTTPS, rate limiting, input validation, audit logs, and proper admin provisioning before real use.

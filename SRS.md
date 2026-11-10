# Software Requirements Specification (SRS)
## Project Name: ParkAssist (Smart Vehicle Incident Reporting & Alert System)
**Document Version:** 1.0.0  
**Standard:** IEEE 830-1998 Compliant  
**Project Group:** Group 14  
**Date:** November 2026  

---

## 1. Introduction

### 1.1 Purpose
The purpose of this document is to specify the complete Software Requirements Specification (SRS) for **ParkAssist**, an intelligent, privacy-preserving vehicle incident reporting and owner notification system. This document outlines the functional and non-functional requirements, system architecture, data models, external interfaces, and security constraints for both developers, evaluators, and stakeholders.

### 1.2 Scope
ParkAssist solves the critical urban challenge of anonymous communication between the public/traffic wardens and parked vehicle owners during parking-related issues (e.g., vehicle blocking driveways/gates, open windows, lights left on, minor accidental damage, emergency towing, illegal parking).

The system allows vehicle owners to attach an anonymous, tamper-proof QR sticker to their windshield. Bystanders or reporters can scan the QR code using any smartphone camera or web browser to submit an incident report with descriptions, photographs, and GPS coordinates **without revealing the owner's phone number, email address, or identity**. The system routes immediate, multi-channel alerts (Push notifications, Email alerts, SMS) to the registered owner.

### 1.3 Definitions, Acronyms, and Abbreviations
- **SRS:** Software Requirements Specification
- **QR Code:** Quick Response 2-Dimensional Barcode
- **FCM:** Firebase Cloud Messaging
- **SMTP:** Simple Mail Transfer Protocol
- **JWT:** JSON Web Token
- **REST:** Representational State Transfer
- **PWA:** Progressive Web Application / Mobile-Optimized Web App
- **RBAC:** Role-Based Access Control
- **LAN:** Local Area Network
- **GPS:** Global Positioning System

### 1.4 References
- IEEE Std 830-1998: IEEE Recommended Practice for Software Requirements Specifications
- RFC 7519: JSON Web Token (JWT) Architecture
- RFC 5321: Simple Mail Transfer Protocol (SMTP)
- ISO/IEC 18004: Information technology — QR Code bar code symbology specification

### 1.5 Overview
The remainder of this document is divided into:
- **Section 2:** Overall Description (product perspective, user classes, operating environment)
- **Section 3:** System Features & Functional Requirements (organized by submodules)
- **Section 4:** External Interface Requirements (UI, hardware, software, communications)
- **Section 5:** Non-Functional Requirements (performance, security, privacy, reliability)
- **Section 6:** Data Models & Database Design

---

## 2. Overall Description

### 2.1 Product Perspective
ParkAssist is an independent, distributed client-server ecosystem composed of three principal interfaces:
1. **Vehicle Owner Mobile Application (`mobile`):** Cross-platform React Native / Expo application for vehicle registration, QR sticker generation, live incident monitoring, and push notification receipt.
2. **Administrator Console (`admin_app` + Web Console):** Dedicated administrative interface for campus/city parking enforcement to monitor all vehicles, review incident feeds, manage users, and inspect real-time metrics.
3. **Public Reporter Web Interface (`backend/templates/reporter.html`):** Lightweight, zero-install mobile web page accessed directly when any bystander scans the vehicle windshield QR sticker.
4. **Central Backend REST Service (`backend`):** Python Flask REST API connected to MongoDB Atlas for persistence, handling token verification, incident rate limiting, and dispatching notifications.

```
       +-------------------------------------------------------------+
       |               Public Bystander / Reporter                   |
       |             (Scans Windshield QR Code in Web)               |
       +------------------------------+------------------------------+
                                      | HTTP POST /api/incidents
                                      v
       +-------------------------------------------------------------+
       |                 Central Flask REST Backend                  |
       |  - Token Resolver (Zero-PII Lookup)                         |
       |  - Rate-Limiter & Deduplication Engine                      |
       |  - JWT Authentication & RBAC Engine                         |
       +--------------+------------------------------+---------------+
                      |                              |
       +--------------v--------------+ +-------------v---------------+
       |       MongoDB Atlas         | |  Multi-Channel Notification |
       |  (Users, Vehicles, Events)  | |  - In-App Push (ntfy / FCM) |
       |  - Local JSON Fallback DB   | |  - Email Alerts (SMTP/Brevo)|
       +-----------------------------+ |  - Mobile SMS (Twilio Gate) |
                                       +-------------+---------------+
                                                     |
                      +------------------------------+
                      v                              v
       +------------------------------+ +----------------------------+
       |    Vehicle Owner App (Expo)  | |   Campus Admin App (Expo)  |
       |  - Live Alerts & Resolution  | |  - Global Monitoring Audit |
       +------------------------------+ +----------------------------+
```

### 2.2 User Classes and Characteristics
1. **Vehicle Owner:**
   - Registers account with email, password, and contact phone number.
   - Registers one or more personal vehicles.
   - Generates and downloads windshield QR stickers.
   - Receives instant incident notifications; reviews photos, location, and severity; marks incidents as Acknowledged or Resolved.
2. **Public Reporter / Bystander:**
   - Anyone encountering an issue with a parked vehicle.
   - Requires **no login, no account creation, and no app download**.
   - Scans the QR code to open the public reporter page, selects incident type, optionally takes a photo and attaches GPS location, and submits.
3. **Parking Enforcement / Administrator:**
   - Campus security or municipal traffic administration.
   - Possesses elevated administrative credentials (`role: admin`).
   - Audits all registered vehicles, all active QR tokens, incident histories, and user accounts.
   - Deletes improper records, reviews duplicate patterns, and tracks resolution metrics.

### 2.3 Operating Environment
- **Server Environment:** Python 3.10+ (Flask, PyMongo, DNS Resolver, Werkzeug, Twilio SDK, ntfy.sh integration). Compatible with Linux, Windows, macOS, or Docker containers.
- **Database:** MongoDB 6.0+ (Local MongoDB Community Server or MongoDB Atlas cloud cluster) with automatic local filesystem JSON fallback for resilient offline operation.
- **Client Platforms:** 
  - Mobile Apps: Android 9.0+ and iOS 13.0+ via Expo / React Native.
  - Reporter Web Page: Modern HTML5 web browsers (Chrome, Safari, Firefox, Edge) supporting Geolocation API and camera access.

### 2.4 Design and Implementation Constraints
1. **Zero-PII in QR Codes:** The QR code must strictly encode an opaque cryptographic identifier (e.g., `vk_94c6536...`) and must never contain plaintext phone numbers, email addresses, or owner identities.
2. **Network Resilience:** The backend must handle DNS SRV query limitations on corporate/campus Wi-Fi and fallback to public resolvers (Google `8.8.8.8` / Cloudflare `1.1.1.1`).
3. **No-Registration Requirement for Public Reporters:** To maximize real-world adoption, reporters must not encounter barrier-to-entry registration forms.

---

## 3. System Features & Functional Requirements

### 3.1 Module 1: User Authentication & Profile Management
- **FR-AUTH-1:** The system shall allow users to register an account using Name, valid Email address, Password, and contact Phone Number.
- **FR-AUTH-2:** The system shall hash all passwords using PBKDF2/SHA256 via `werkzeug.security` before storing them in the database.
- **FR-AUTH-3:** The system shall authenticate users via `POST /api/auth/login` and issue an industry-standard signed JWT with a configurable expiration period (default 7 days).
- **FR-AUTH-4:** The system shall support Role-Based Access Control (RBAC), distinguishing between standard `user` (vehicle owner) and `admin` roles.

### 3.2 Module 2: Vehicle Registration & Privacy-Preserving QR Generation
- **FR-VEH-1:** An authenticated vehicle owner shall be able to register a vehicle by providing Registration Number (License Plate), Make, and Model.
- **FR-VEH-2:** Upon vehicle creation, the backend shall generate a cryptographically random, globally unique vehicle token prefixed with `vk_` (e.g. `vk_a7d9e1...`).
- **FR-VEH-3:** The mobile app shall render the vehicle token into an ISO/IEC 18004 compliant QR Code image, linking to the public reporter endpoint: `http://<SERVER_HOST>:<PORT>/report/<TOKEN>`.
- **FR-VEH-4:** The owner shall be able to view, download, or share their vehicle QR sticker directly from the mobile app.
- **FR-VEH-5:** The system shall provide an endpoint `GET /api/vehicles/public/<token>` that returns only non-sensitive vehicle metadata (Make, Model, and masked Registration Plate, e.g., `WB02****44`). Owner contact details must be stripped.

### 3.3 Module 3: Anonymous Incident Reporting (Public Web Portal)
- **FR-REP-1:** When a user accesses `/report/<token>`, the server shall serve a responsive, mobile-first reporter form.
- **FR-REP-2:** The reporter shall be presented with predefined incident categories:
  - *Vehicle Blocking Driveway / Double Parked*
  - *Headlights / Parking Lights Left On*
  - *Window Left Open / Door Ajar*
  - *Minor Scratch / Accidental Collision*
  - *Flat Tire / Hazard Detected*
  - *Emergency Towing / Security Notice*
  - *Other Parking Issue*
- **FR-REP-3:** The reporter form shall support attaching an optional photo (via base64 or secure image capture) as visual proof.
- **FR-REP-4:** The reporter form shall support one-click GPS coordinate capture using the browser's Geolocation API.
- **FR-REP-5:** The system shall enforce duplicate protection: if an identical report type is filed for the same vehicle within a cooldown threshold (10 minutes), it shall be flagged as duplicate or batched to prevent harassment.

### 3.4 Module 4: Multi-Channel Owner Notification Pipeline
- **FR-NOTIF-1:** Upon receipt of a valid incident report, the system shall asynchronously dispatch alerts across three simultaneous communication channels:
  1. **Instant Push Notification:** Dispatched via high-priority pub/sub (ntfy channel `parkassist_<owner_phone_hash>`) with immediate heads-up mobile notification, title, severity tag, and direct action link.
  2. **Email Alert:** Dispatched via SMTP (or Brevo/Resend HTTP API) to the owner's registered email address, with incident description, vehicle plate, timestamp, and incident tracker link.
  3. **SMS Alert:** Dispatched via Twilio Telecom Gateway (with graceful console logging fallback) directly to the owner's mobile phone number.
- **FR-NOTIF-2:** If the Wi-Fi or local network blocks standard outbound mail ports (25, 465, 587), the system shall log a structured diagnostic notification without crashing the transaction.

### 3.5 Module 5: Incident Management & Resolution (Owner App)
- **FR-MGT-1:** The vehicle owner shall see all received alerts in real-time in the "Reports" / "Incidents" tab of the mobile app.
- **FR-MGT-2:** The owner shall be able to view attached incident photos and open reported GPS coordinates in Google Maps with a single tap.
- **FR-MGT-3:** The owner shall be able to cycle incident lifecycle status:
  $$\text{Open} \longrightarrow \text{Acknowledged} \longrightarrow \text{Resolved}$$
- **FR-MGT-4:** Status updates shall be time-stamped and recorded in the audit trail.

### 3.6 Module 6: Administrator Audit & Fleet Console
- **FR-ADM-1:** Administrators shall have dedicated credentials to access `admin_app` and `/admin` web interface.
- **FR-ADM-2:** The console shall display high-level system metrics: Total Registered Vehicles, Total Incident Reports, Resolved vs. Open ratio, and Registered Users.
- **FR-ADM-3:** Administrators shall have full search and filter capabilities across license plate, vehicle token, owner name, and incident category.
- **FR-ADM-4:** Administrators shall be able to dismiss frivolous reports or delete vehicle entries with immediate database synchronization.

---

## 4. External Interface Requirements

### 4.1 User Interfaces
- **Mobile Application:** Responsive mobile UI created in React Native, styled with an accessible dark palette (`#0f172a`, `#1e293b`), card-based item lists, status pills, and intuitive bottom tab navigation.
- **Reporter Web Form:** Touch-optimized HTML5/CSS3 form, compatible with iOS Safari and Android Chrome, featuring large action buttons and zero pinch-to-zoom requirement.

### 4.2 Hardware Interfaces
- **Smartphone Camera:** Standard optical camera used by bystanders to scan QR stickers.
- **Windshield Sticker:** Printed physical adhesive sticker containing high-contrast ISO/IEC 18004 QR code and instructions: *"ParkAssist: Scan to alert vehicle owner anonymously"*.

### 4.3 Software & API Interfaces
- **Database Connection:** MongoDB Wire Protocol via `pymongo` (URI format: `mongodb+srv://...`).
- **Push Notification Service:** ntfy.sh REST API and Firebase Cloud Messaging HTTP v1 API.
- **Email Service:** Standard RFC 5321 SMTP servers (Gmail, SendGrid) and RESTful transactional email endpoints.
- **SMS Gateway:** Twilio REST API (`/2010-04-01/Accounts/{AccountSid}/Messages.json`).
- **Mapping Service:** Google Maps Deep Link URL scheme (`https://www.google.com/maps/search/?api=1&query={lat},{lng}`).

---

## 5. Non-Functional Requirements (NFRs)

### 5.1 Security Requirements
- **NFR-SEC-1 (Zero Knowledge QR):** Under no circumstance shall the vehicle owner's identity, phone number, or email be embedded in the QR code or returned by public query endpoints.
- **NFR-SEC-2 (JWT Token Security):** All protected endpoints require a signed `Authorization: Bearer <token>` header verified using `HS256` algorithm and secret key.
- **NFR-SEC-3 (Sanitization & Secret Isolation):** Production source control must never track real secrets, API keys, passwords, or connection strings (`.gitignore` enforcement).

### 5.2 Performance Requirements
- **NFR-PERF-1 (Response Latency):** The `GET /api/vehicles/public/<token>` endpoint shall respond within $\le 300\text{ ms}$ under normal conditions.
- **NFR-PERF-2 (Notification Delivery):** Push notifications and email dispatches shall be handed off asynchronously or within $\le 2.0\text{ seconds}$ of incident submission.
- **NFR-PERF-3 (Lightweight Bundle):** The public reporter web page must load within $\le 1.5\text{ seconds}$ on 4G cellular connections without requiring external heavy JavaScript frameworks.

### 5.3 Reliability and Fault Tolerance
- **NFR-REL-1 (Database Fallback):** If MongoDB Atlas connection fails or DNS resolution drops, the backend shall automatically fall back to local disk persistence (`backend/data/*.json`) without rejecting incident submissions.
- **NFR-REL-2 (DNS Fallback):** The backend shall configure public backup nameservers (`8.8.8.8`, `1.1.1.1`) to guarantee DNS SRV resolution on restricted networks.

### 5.4 Privacy and Compliance
- **NFR-PRIV-1:** Masking of license plates in public views (e.g., displaying `DL-01-****-1234`).
- **NFR-PRIV-2:** Incident photos must be submitted voluntarily by the reporter and used solely for resolution validation.

---

## 6. Data Models & Database Design

### 6.1 Entity-Relationship Overview
The system relies on three primary entities: `User`, `Vehicle`, and `Incident`.

```
+--------------------+        1 : N         +--------------------+
|       User         | -------------------> |      Vehicle       |
+--------------------+                      +--------------------+
| _id: ObjectId      |                      | _id: ObjectId      |
| name: String       |                      | owner_id: ObjectId |
| email: String      |                      | reg_no: String     |
| password_hash: Str |                      | make: String       |
| phone: String      |                      | model: String      |
| role: String       |                      | token: String (UQ) |
| created_at: Date   |                      | created_at: Date   |
+--------------------+                      +--------------------+
          |                                            |
          | 1 : N                                      | 1 : N
          v                                            v
+----------------------------------------------------------------+
|                           Incident                             |
+----------------------------------------------------------------+
| _id: ObjectId                                                  |
| vehicle_id: ObjectId                                           |
| owner_id: ObjectId                                             |
| type: String                                                   |
| description: String                                            |
| photo_url: String (optional)                                   |
| coordinates: { latitude: Float, longitude: Float }             |
| status: Enum ['open', 'acknowledged', 'resolved', 'dismissed'] |
| is_duplicate: Boolean                                          |
| created_at: Date                                               |
| updated_at: Date                                               |
+----------------------------------------------------------------+
```

### 6.2 Schema Definitions

#### 1. `users` Collection
| Field | Type | Description | Constraints |
| :--- | :--- | :--- | :--- |
| `_id` | ObjectId | Unique identifier | Primary Key |
| `name` | String | Full name of the user | Mandatory |
| `email` | String | Email address (login identifier) | Unique, Indexed |
| `password_hash`| String | PBKDF2 cryptographic hash | Never stored plain |
| `phone` | String | Contact phone number for SMS/Push | Valid E.164 format |
| `role` | String | Access role (`user` or `admin`) | Default: `user` |
| `created_at` | DateTime | Account creation timestamp | UTC ISO 8601 |

#### 2. `vehicles` Collection
| Field | Type | Description | Constraints |
| :--- | :--- | :--- | :--- |
| `_id` | ObjectId | Unique identifier | Primary Key |
| `owner_id` | ObjectId | Reference to `users._id` | Foreign Key, Indexed |
| `registration_number` | String | Official vehicle plate number | Indexed, Upper-cased |
| `make` | String | Vehicle manufacturer (e.g., Hyundai) | Mandatory |
| `model` | String | Vehicle model (e.g., i20) | Mandatory |
| `token` | String | Cryptographic public identifier | Unique, Indexed (`vk_*`) |
| `created_at` | DateTime | Vehicle registration timestamp | UTC ISO 8601 |

#### 3. `incidents` Collection
| Field | Type | Description | Constraints |
| :--- | :--- | :--- | :--- |
| `_id` | ObjectId | Unique identifier | Primary Key |
| `vehicle_id` | ObjectId | Reference to `vehicles._id` | Foreign Key, Indexed |
| `owner_id` | ObjectId | Reference to `users._id` | Foreign Key, Indexed |
| `type` | String | Incident category | Enum predefined |
| `description` | String | Detailed report description | Optional |
| `photo_url` | String | Base64 or URI of uploaded proof | Optional |
| `coordinates` | Object | `{ latitude: Float, longitude: Float }` | Optional GPS |
| `status` | String | `open`, `acknowledged`, `resolved` | Default: `open` |
| `is_duplicate`| Boolean | Duplicate detection flag | Default: `false` |
| `created_at` | DateTime | Submission timestamp | UTC ISO 8601 |

---

## 7. Verification & Acceptance Criteria
1. **QR Scanning Test:** Scanning the QR code with an unauthenticated phone camera must open the reporter page and populate the vehicle information within $\le 2$ seconds.
2. **Privacy Audit:** Public API endpoints must never output `email`, `phone`, or `password_hash` in network inspector traces.
3. **Multi-Channel Alert Test:** Submitting an incident report must trigger a push notification banner on the owner's phone within $\le 3$ seconds and deliver an email alert to the owner's inbox.
4. **Offline Resilience:** If the database network connection is intentionally interrupted, the server must automatically store the incident to disk and return HTTP 201 without loss of data.

# ParkAssist — 90-second presentation script

Good morning. Our project is ParkAssist, a QR-based vehicle incident reporting and privacy-preserving communication system.

The problem is that when a parked vehicle blocks a driveway or creates another issue, a person may not know how to contact its owner. Sharing the owner's phone number publicly would create a privacy risk.

ParkAssist solves this by giving every registered vehicle a unique QR identifier. A reporter scans the code and submits an incident without creating an account. The backend links the report to the correct owner, but the reporter does not receive the owner's private contact details. The owner can acknowledge and resolve the incident, while the administrator reviews reports and suspicious activity.

Our planned technology stack is React Native for the mobile interface, Python Flask for REST APIs, MongoDB for storing users, vehicles and incidents, and Firebase Cloud Messaging for push notifications. The QR token contains only a random identifier, not personal information.

In this prototype, we will demonstrate the owner workflow, public incident submission, and administrator incident review. QR scanning, production Firebase setup, photo uploads, and deployment hardening are follow-up tasks. The project follows the SRS requirements for authentication, vehicle and QR management, incident lifecycle, notifications, privacy, and administration.

Thank you.

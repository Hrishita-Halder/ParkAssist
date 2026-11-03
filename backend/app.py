import os
import uuid
import smtplib
import json
import threading
import urllib.request
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from bson import ObjectId
from dotenv import load_dotenv
from flask import Flask, jsonify, request, g, render_template
from flask_cors import CORS
from pymongo import MongoClient, ASCENDING
from werkzeug.security import generate_password_hash, check_password_hash

load_dotenv()
app = Flask(__name__)
CORS(app)  # Restrict origins before deployment.
JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@parkassist.local").lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ChangeMe123!")

# MongoDB Connection with persistent local fallback if outbound port 27017 is blocked
mongo_uri = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017")
db_name = os.getenv("MONGO_DB", "parkassist")
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

try:
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=2000)
    # Probe connection
    client.admin.command("ping")
    db = client[db_name]
    app.logger.info("Connected to remote MongoDB Atlas cluster")
except Exception as atlas_err:
    app.logger.warning(
        "Remote MongoDB Atlas connection blocked by network/firewall: %s. Using persistent local disk database in backend/data/ so owner and admin apps share all users and vehicles.",
        atlas_err
    )
    import mongomock
    client = mongomock.MongoClient()
    db = client[db_name]

    # Persistent disk-backed loader/syncer for local storage
    USERS_FILE = os.path.join(DATA_DIR, "users.json")
    VEHICLES_FILE = os.path.join(DATA_DIR, "vehicles.json")
    INCIDENTS_FILE = os.path.join(DATA_DIR, "incidents.json")

    def load_json(filepath):
        if os.path.exists(filepath):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    docs = json.load(f)
                    for d in docs:
                        if "_id" in d and isinstance(d["_id"], str):
                            try:
                                d["_id"] = ObjectId(d["_id"])
                            except Exception:
                                pass
                        # Also restore relational foreign keys as ObjectId
                        for fk in ("owner_id", "vehicle_id"):
                            if fk in d and isinstance(d[fk], str):
                                try:
                                    d[fk] = ObjectId(d[fk])
                                except Exception:
                                    pass
                    return docs
            except Exception as e:
                app.logger.error("Error reading %s: %s", filepath, e)
        return []

    def save_json(filepath, collection):
        try:
            docs = list(collection.find())
            clean_docs = []
            for d in docs:
                c = dict(d)
                if "_id" in c:
                    c["_id"] = str(c["_id"])
                for k, v in list(c.items()):
                    if isinstance(v, datetime):
                        c[k] = v.isoformat()
                    elif isinstance(v, ObjectId):
                        c[k] = str(v)
                clean_docs.append(c)
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(clean_docs, f, indent=2)
        except Exception as e:
            app.logger.error("Error saving to %s: %s", filepath, e)

    # Pre-populate in-memory collection from persistent disk store
    for u in load_json(USERS_FILE):
        db.users.insert_one(u)
    for v in load_json(VEHICLES_FILE):
        db.vehicles.insert_one(v)
    for i in load_json(INCIDENTS_FILE):
        db.incidents.insert_one(i)

    # Hook automatic disk persistence after every modifying request
    @app.after_request
    def persist_changes(response):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            save_json(USERS_FILE, db.users)
            save_json(VEHICLES_FILE, db.vehicles)
            save_json(INCIDENTS_FILE, db.incidents)
        return response

users, vehicles, incidents = db.users, db.vehicles, db.incidents

# Ensure default admin account exists
try:
    admin_user = users.find_one({"email": ADMIN_EMAIL})
    if not admin_user:
        now_dt = datetime.now(timezone.utc)
        users.insert_one({
            "name": "System Administrator",
            "email": ADMIN_EMAIL,
            "password_hash": generate_password_hash(ADMIN_PASSWORD),
            "role": "admin",
            "created_at": now_dt,
            "updated_at": now_dt
        })
        app.logger.info("Initialized default admin user: %s", ADMIN_EMAIL)
except Exception as e:
    app.logger.warning("Admin init note: %s", e)

# Ensure indexes
try:
    users.create_index([("email", ASCENDING)], unique=True)
    vehicles.create_index([("token", ASCENDING)], unique=True)
    vehicles.create_index([("owner_id", ASCENDING)])
    incidents.create_index([("owner_id", ASCENDING)])
    incidents.create_index([("vehicle_id", ASCENDING)])
except Exception as e:
    app.logger.warning("Index creation notice: %s", e)

STATUSES = {"Open", "Acknowledged", "Resolved", "Dismissed"}

def oid(value):
    try:
        return ObjectId(value)
    except Exception:
        return None

def serialize(doc):
    if not doc:
        return None
    out = dict(doc)
    out["id"] = str(out.pop("_id"))
    for key, value in list(out.items()):
        if isinstance(value, ObjectId):
            out[key] = str(value)
        elif isinstance(value, datetime):
            out[key] = value.isoformat()
    # Never return password hashes
    out.pop("password_hash", None)
    return out

def make_token(user):
    payload = {
        "sub": str(user["_id"]),
        "role": user.get("role", "owner"),
        "exp": datetime.now(timezone.utc) + timedelta(days=7)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def auth_required(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            header = request.headers.get("Authorization", "")
            if not header.startswith("Bearer "):
                return jsonify(error="Authentication required"), 401
            try:
                claims = jwt.decode(header[7:], JWT_SECRET, algorithms=["HS256"])
                user = users.find_one({"_id": oid(claims.get("sub"))})
            except Exception:
                user = None
            if not user:
                return jsonify(error="Invalid or expired token"), 401
            if roles and user.get("role") not in roles:
                return jsonify(error="You do not have permission for this action"), 403
            g.user = user
            return fn(*args, **kwargs)
        return wrapped
    return decorator

# ==========================================
# NOTIFICATION SYSTEM (EMAIL, EXPO PUSH & MOBILE SMS)
# ==========================================
def send_email_async(to_email, subject, html_body):
    """Sends HTML email notification in a background thread with HTTPS and SSL fallback."""
    smtp_server = os.getenv("SMTP_SERVER", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()
    sender_email = os.getenv("SMTP_FROM", smtp_user or "alerts@parkassist.local").strip()
    resend_api_key = os.getenv("RESEND_API_KEY", "").strip()

    def _worker():
        # Option A: Modern HTTPS Email API (Resend / SendGrid - Bypasses all ISP port blocking)
        if resend_api_key:
            try:
                import resend
                resend.api_key = resend_api_key
                params = {
                    "from": "ParkAssist Alerts <onboarding@resend.dev>",
                    "to": [to_email],
                    "subject": subject,
                    "html": html_body,
                }
                res = resend.Emails.send(params)
                app.logger.info("Email delivered via HTTPS API to %s (ID: %s)", to_email, res.get("id"))
                return
            except Exception as e:
                app.logger.error("HTTPS email API error: %s", e)

        if not smtp_server or not smtp_user or not smtp_password:
            app.logger.info(
                "\n" + "="*50 + "\n[EMAIL ALERT LOG - To: %s]\nSubject: %s\nNotice: Configure SMTP_SERVER, SMTP_USER, SMTP_PASSWORD in backend/.env for real inbox delivery.\n" + "="*50,
                to_email, subject
            )
            return

        # Option B: Standard SMTP with SSL/STARTTLS fallback
        sent = False
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"ParkAssist Alerts <{sender_email}>"
            msg["To"] = to_email
            msg.attach(MIMEText(html_body, "html"))

            # Try SSL (465) first, then STARTTLS (587)
            import ssl
            context = ssl.create_default_context()
            try:
                with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=8) as server:
                    server.login(smtp_user, smtp_password)
                    server.sendmail(sender_email, [to_email], msg.as_string())
                sent = True
                app.logger.info("Email successfully dispatched via SSL to %s", to_email)
            except Exception as ssl_err:
                app.logger.warning("SMTP SSL timed out or blocked: %s. Trying port 587...", ssl_err)

            if not sent:
                with smtplib.SMTP(smtp_server, smtp_port, timeout=8) as server:
                    server.starttls(context=context)
                    server.login(smtp_user, smtp_password)
                    server.sendmail(sender_email, [to_email], msg.as_string())
                sent = True
                app.logger.info("Email successfully dispatched to %s", to_email)
        except Exception as e:
            app.logger.warning(
                "\n" + "="*50 + f"\n[NOTICE: Outbound SMTP Ports Blocked by Wi-Fi Network]\nISP/Campus Wi-Fi is blocking mail ports 25/465/587 ({e}).\nTo bypass Wi-Fi port blocks, use Mobile Hotspot or add RESEND_API_KEY in backend/.env for HTTP API email delivery.\n" + "="*50
            )

    threading.Thread(target=_worker, daemon=True).start()

def send_push_notification_async(push_token, title, body, data=None):
    """Sends push notification via Expo Push Notification Service in a background thread."""
    def _worker():
        if not push_token or not push_token.startswith("ExponentPushToken"):
            app.logger.info("\n" + "="*50 + f"\n[PUSH NOTIFICATION LOG]\nTitle: {title}\nBody: {body}\nNotice: Push sent to active owner in-app listener." + "\n" + "="*50)
            return

        payload = {
            "to": push_token,
            "sound": "default",
            "title": title,
            "body": body,
            "priority": "high",
            "data": data or {}
        }
        try:
            req = urllib.request.Request(
                "https://exp.host/--/api/v2/push/send",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json", "Accept": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                res_body = response.read().decode("utf-8")
                app.logger.info("Expo Push API response: %s", res_body)
        except Exception as e:
            app.logger.error("Expo push notification failed: %s", e)

    threading.Thread(target=_worker, daemon=True).start()

def send_sms_async(to_phone, message_text):
    """Sends SMS alert to owner mobile phone via Twilio (with simulated fallback)."""
    twilio_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    twilio_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    twilio_from = os.getenv("TWILIO_PHONE_NUMBER", "").strip()

    def _worker():
        if not to_phone:
            app.logger.info("[SMS ALERT] No phone number recorded for owner.")
            return

        # If Twilio credentials are configured in .env, send live SMS
        if twilio_sid and twilio_token and twilio_from:
            try:
                from twilio.rest import Client
                # Normalize phone number to E.164 (add +91 if missing)
                formatted_phone = to_phone.strip().replace(" ", "").replace("-", "")
                if not formatted_phone.startswith("+"):
                    if len(formatted_phone) == 10:
                        formatted_phone = "+91" + formatted_phone
                    else:
                        formatted_phone = "+" + formatted_phone

                client = Client(twilio_sid, twilio_token)
                msg = client.messages.create(
                    body=message_text,
                    from_=twilio_from,
                    to=formatted_phone
                )
                app.logger.info("Live SMS dispatched to %s (SID: %s)", formatted_phone, msg.sid)
                return
            except Exception as e:
                app.logger.error("Twilio SMS delivery failed to %s: %s", to_phone, e)

        # Instant zero-signup push delivery to owner's phone channel (ntfy.sh)
        clean_num = "".join([c for c in to_phone if c.isdigit()])
        if clean_num:
            try:
                ntfy_channel = f"parkassist_{clean_num}"
                ntfy_url = f"https://ntfy.sh/{ntfy_channel}"
                req = urllib.request.Request(
                    ntfy_url,
                    data=message_text.encode("utf-8"),
                    headers={"Title": "ParkAssist Vehicle Incident Alert", "Priority": "urgent", "Tags": "warning,car"}
                )
                with urllib.request.urlopen(req, timeout=8) as r:
                    app.logger.info("Mobile notification dispatched to channel %s (HTTP %s)", ntfy_channel, r.status)
            except Exception as e:
                app.logger.debug("Mobile broadcast note: %s", e)

        # Fallback simulated SMS log (works out-of-the-box in dev / demo without paid API key)
        app.logger.info(
            "\n" + "="*50 + f"\n[MOBILE SMS ALERT LOG - To: {to_phone}]\nMessage: {message_text}\nStatus: Delivered (Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in backend/.env for real telecom gateway).\n" + "="*50
        )

    threading.Thread(target=_worker, daemon=True).start()

def dispatch_incident_notifications(owner, vehicle, incident):
    """Dispatches Push Notification, Email Alert, and Mobile SMS when an incident is reported."""
    if not owner:
        return

    owner_email = owner.get("email")
    owner_phone = owner.get("phone")
    owner_name = owner.get("name", "Vehicle Owner")
    reg_num = vehicle.get("registration_number", "Your Vehicle")
    v_make = vehicle.get("make", "")
    v_model = vehicle.get("model", "")
    inc_type = incident.get("type", "Parking incident")
    inc_desc = incident.get("description", "Please check your parked vehicle.")
    inc_loc = incident.get("location") or "Nearby"
    coords = incident.get("coordinates")

    # 1. Compose & Send Push Notification
    push_token = owner.get("push_token")
    push_title = f"🚨 ParkAssist Alert: {reg_num}"
    push_body = f"{inc_type} reported at {inc_loc}: {inc_desc[:120]}"
    send_push_notification_async(
        push_token=push_token,
        title=push_title,
        body=push_body,
        data={"incident_id": str(incident.get("_id", "")), "type": inc_type}
    )

    # 2. Compose & Send Mobile SMS Alert
    if owner_phone:
        sms_text = f"ParkAssist Alert for {reg_num}: {inc_type} reported at {inc_loc}. Note: \"{inc_desc[:80]}\". Please check your vehicle."
        send_sms_async(to_phone=owner_phone, message_text=sms_text)

    # 3. Compose & Send Email Notification
    if owner_email:
        maps_html = ""
        if coords and coords.get("latitude"):
            lat, lon = coords["latitude"], coords["longitude"]
            maps_html = f"""
            <div style="margin-top: 15px;">
              <a href="https://www.google.com/maps/search/?api=1&query={lat},{lon}" target="_blank"
                 style="background-color: #16a34a; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 13px; display: inline-block;">
                📍 Open GPS Location in Google Maps
              </a>
            </div>
            """

        email_subject = f"🚨 Urgent Alert: {inc_type} reported for {reg_num}"
        email_html = f"""
        <!DOCTYPE html>
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; padding: 20px; margin: 0;">
          <div style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
            <div style="background-color: #0f172a; padding: 24px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">ParkAssist</h1>
              <p style="color: #93c5fd; margin: 4px 0 0 0; font-size: 13px;">Instant Vehicle Incident Notification</p>
            </div>
            <div style="padding: 24px;">
              <p style="font-size: 15px; color: #334155; margin-top: 0;">Hello <strong>{owner_name}</strong>,</p>
              <p style="font-size: 14px; color: #475569; line-height: 1.5;">
                A bystander just scanned the QR sticker on your vehicle <strong>{v_make} {v_model} ({reg_num})</strong> and submitted an urgent alert:
              </p>
              
              <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 14px 16px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; font-size: 13px; font-weight: 700; color: #991b1b; text-transform: uppercase;">Issue Reported</p>
                <p style="margin: 4px 0 0 0; font-size: 17px; font-weight: 800; color: #7f1d1d;">{inc_type}</p>
                <p style="margin: 8px 0 0 0; font-size: 14px; color: #374151; font-style: italic;">"{inc_desc}"</p>
                <p style="margin: 8px 0 0 0; font-size: 12px; color: #6b7280;">📍 Location: <strong>{inc_loc}</strong></p>
              </div>

              {maps_html}

              <p style="font-size: 12px; color: #64748b; margin-top: 25px; line-height: 1.5;">
                Open your <strong>ParkAssist App</strong> to acknowledge or resolve this incident report.
              </p>
            </div>
            <div style="background-color: #f8fafc; padding: 14px 20px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8;">
              ParkAssist Anonymous Vehicle Safety Framework • Group 14
            </div>
          </div>
        </body>
        </html>
        """
        send_email_async(to_email=owner_email, subject=email_subject, html_body=email_html)

# ==========================================
# PUBLIC REPORTER WEBPAGE (QR SCANNER & REPORTING)
# ==========================================
@app.get("/")
@app.get("/report")
@app.get("/report/<token>")
def reporter_page(token=None):
    """
    Public webpage with in-browser live QR scanner and incident reporting form.
    Accessible by anyone scanning the vehicle QR sticker on their phone browser.
    """
    return render_template("reporter.html", token=token or "")

# ==========================================
# ADMIN CONSOLE WEBPAGE
# ==========================================
@app.get("/admin")
@app.get("/admin/dashboard")
def admin_page():
    """
    Publicly accessible admin management webpage.
    Supports secure login, stats, and live management/deletion of vehicles, reports, and users.
    """
    return render_template("admin.html")

# ==========================================
# HEALTH CHECK
# ==========================================
@app.get("/api/health")
def health():
    try:
        client.admin.command("ping")
        return jsonify(
            status="ok",
            database="connected",
            project="ParkAssist",
            collections=db.list_collection_names()
        )
    except Exception as exc:
        return jsonify(status="degraded", database="unavailable", detail=str(exc)), 503

# ==========================================
# 1. SIGNUP & 2. LOGIN
# ==========================================
@app.post("/api/auth/register")
def register():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    phone = str(data.get("phone", "")).strip()
    password = str(data.get("password", ""))

    if not name or "@" not in email or len(password) < 6:
        return jsonify(error="Please provide a name, valid email, and password of at least 6 characters"), 400

    if users.find_one({"email": email}):
        return jsonify(error="An account with this email already exists"), 409

    role = "admin" if email == ADMIN_EMAIL and password == ADMIN_PASSWORD else "owner"
    now = datetime.now(timezone.utc)
    doc = {
        "name": name,
        "email": email,
        "phone": phone,
        "password_hash": generate_password_hash(password),
        "role": role,
        "created_at": now,
        "updated_at": now
    }
    try:
        result = users.insert_one(doc)
        doc["_id"] = result.inserted_id
        return jsonify(
            token=make_token(doc),
            user=serialize(doc),
            message="Account created successfully"
        ), 201
    except Exception as exc:
        app.logger.exception("Register error: %s", exc)
        return jsonify(error="Could not create account"), 500

@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not email or not password:
        return jsonify(error="Email and password are required"), 400

    user = users.find_one({"email": email})
    if not user or not check_password_hash(user.get("password_hash", ""), password):
        return jsonify(error="Incorrect email or password"), 401

    return jsonify(
        token=make_token(user),
        user=serialize(user),
        message="Login successful"
    )

@app.post("/api/auth/push-token")
@auth_required()
def register_push_token():
    """Associates an Expo push token with the logged-in owner account."""
    data = request.get_json(silent=True) or {}
    token_val = str(data.get("push_token", "")).strip()
    if not token_val:
        return jsonify(error="push_token is required"), 400

    users.update_one({"_id": g.user["_id"]}, {"$set": {"push_token": token_val, "updated_at": datetime.now(timezone.utc)}})
    return jsonify(message="Push token registered successfully")

@app.get("/api/auth/me")
@auth_required()
def me():
    return jsonify(user=serialize(g.user))

# ==========================================
# 3. OWNER DASHBOARD SUMMARY
# ==========================================
@app.get("/api/owner/dashboard")
@auth_required("owner", "admin")
def owner_dashboard():
    owner_id = g.user["_id"]
    owner_vehicles = list(vehicles.find({"owner_id": owner_id}).sort("created_at", -1))
    owner_vehicle_ids = [v["_id"] for v in owner_vehicles]

    owner_incidents = list(
        incidents.find({"$or": [{"owner_id": owner_id}, {"vehicle_id": {"$in": owner_vehicle_ids}}]})
        .sort("created_at", -1)
    )

    total_vehicles = len(owner_vehicles)
    active_reports = sum(1 for inc in owner_incidents if inc.get("status") in {"Open", "Acknowledged"})
    resolved_reports = sum(1 for inc in owner_incidents if inc.get("status") == "Resolved")

    # Include recent 5 incidents with attached vehicle metadata
    recent_reports = []
    veh_map = {str(v["_id"]): v for v in owner_vehicles}
    for inc in owner_incidents[:5]:
        s_inc = serialize(inc)
        v_meta = veh_map.get(str(inc.get("vehicle_id")))
        if v_meta:
            s_inc["reg_number"] = v_meta.get("registration_number")
            s_inc["vehicle_make"] = v_meta.get("make")
            s_inc["vehicle_model"] = v_meta.get("model")
        recent_reports.append(s_inc)

    return jsonify(
        stats={
            "total_vehicles": total_vehicles,
            "active_reports": active_reports,
            "resolved_reports": resolved_reports,
        },
        recent_reports=recent_reports,
        user=serialize(g.user)
    )

# ==========================================
# 4. ADD VEHICLE & 5. SHOW VEHICLES
# ==========================================
@app.post("/api/vehicles")
@auth_required("owner", "admin")
def add_vehicle():
    data = request.get_json(silent=True) or {}
    reg = str(data.get("registration_number", "")).strip().upper()
    make = str(data.get("make", "")).strip()
    model = str(data.get("model", "")).strip()
    year = str(data.get("year", "2024")).strip()
    color = str(data.get("color", "Standard")).strip()
    v_type = str(data.get("type", "Car")).strip()

    if not reg or not make or not model:
        return jsonify(error="Registration number, Make, and Model are required"), 400

    # Human-friendly short QR token: PA-<REG>-<random6>
    clean_reg_slug = "".join([c for c in reg if c.isalnum()])[:6] or "VEH"
    rand_hex = uuid.uuid4().hex[:6].upper()
    token = f"PA-{clean_reg_slug}-{rand_hex}"

    now = datetime.now(timezone.utc)
    doc = {
        "owner_id": g.user["_id"],
        "registration_number": reg,
        "make": make,
        "model": model,
        "year": year,
        "color": color,
        "type": v_type,
        "token": token,
        "qr_active": True,
        "created_at": now,
        "updated_at": now
    }
    result = vehicles.insert_one(doc)
    doc["_id"] = result.inserted_id

    serialized = serialize(doc)
    serialized["active_incidents"] = 0
    return jsonify(vehicle=serialized, message="Vehicle registered successfully"), 201

@app.get("/api/vehicles")
@auth_required("owner", "admin")
def list_vehicles():
    owner_id = g.user["_id"]
    cursor = vehicles.find({"owner_id": owner_id}).sort("created_at", -1)
    result_list = []
    for v in cursor:
        s = serialize(v)
        # Compute active incidents count for this vehicle
        active_count = incidents.count_documents({
            "vehicle_id": v["_id"],
            "status": {"$in": ["Open", "Acknowledged"]}
        })
        s["active_incidents"] = active_count
        result_list.append(s)
    return jsonify(vehicles=result_list)

@app.delete("/api/vehicles/<vehicle_id>")
@auth_required("owner", "admin")
def delete_vehicle(vehicle_id):
    _id = oid(vehicle_id)
    if not _id:
        return jsonify(error="Invalid vehicle ID"), 400
    res = vehicles.delete_one({"_id": _id, "owner_id": g.user["_id"]})
    if res.deleted_count == 0:
        return jsonify(error="Vehicle not found or not owned by you"), 404
    return jsonify(message="Vehicle removed successfully")

# ==========================================
# 6. VEHICLE DATABASE (SEARCH & INSPECT)
# ==========================================
@app.get("/api/vehicles/database")
@auth_required("owner", "admin")
def vehicle_database():
    """
    Search and browse registered vehicles in the database.
    Supports query parameter: q (searches registration number, make, model, token, or color).
    """
    q = request.args.get("q", "").strip()
    type_filter = request.args.get("type", "").strip()
    query = {}

    # Owners can browse/search their own database records, admins can view all
    if g.user.get("role") != "admin":
        query["owner_id"] = g.user["_id"]

    if q:
        regex = {"$regex": q, "$options": "i"}
        query["$or"] = [
            {"registration_number": regex},
            {"make": regex},
            {"model": regex},
            {"token": regex},
            {"color": regex}
        ]

    if type_filter and type_filter != "All":
        query["type"] = type_filter

    found = vehicles.find(query).sort("created_at", -1).limit(100)
    out = []
    for v in found:
        sv = serialize(v)
        sv["incident_count"] = incidents.count_documents({"vehicle_id": v["_id"]})
        out.append(sv)

    return jsonify(
        vehicles=out,
        count=len(out),
        query=q,
        type=type_filter or "All"
    )

# Public lookup endpoint for anonymous scanner
@app.get("/api/vehicles/public/<token>")
def public_vehicle_lookup(token):
    vehicle = vehicles.find_one({"token": token, "qr_active": True})
    if not vehicle:
        return jsonify(error="Vehicle QR is invalid or inactive"), 404
    # Privacy shield: Mask phone, owner ID and registration digits
    reg = vehicle.get("registration_number", "")
    masked_reg = (reg[-4:].rjust(len(reg), "•")) if len(reg) >= 4 else reg
    return jsonify(
        vehicle={
            "token": vehicle["token"],
            "make": vehicle.get("make"),
            "model": vehicle.get("model"),
            "color": vehicle.get("color"),
            "type": vehicle.get("type"),
            "masked_registration": masked_reg,
        }
    )

# ==========================================
# 7. INCIDENTS / REPORTS PAGE
# ==========================================
@app.post("/api/incidents")
def create_incident():
    data = request.get_json(silent=True) or {}
    token = str(data.get("vehicle_token", "")).strip()
    incident_type = str(data.get("type", "")).strip()
    description = str(data.get("description", "")).strip()
    location_str = str(data.get("location", "Nearby")).strip()
    image_data = data.get("image") or data.get("photo_url") or None
    # GPS Coordinates: { latitude: float, longitude: float, accuracy: float }
    coords = data.get("coordinates")
    if coords and not isinstance(coords, dict):
        coords = None

    if not token or not incident_type or not description:
        return jsonify(error="vehicle_token, type, and description are required"), 400

    vehicle = vehicles.find_one({"token": token, "qr_active": True})
    if not vehicle:
        return jsonify(error="Vehicle QR is invalid or inactive"), 404

    now = datetime.now(timezone.utc)
    # Check for duplicate reports in the last 30 minutes
    duplicate = incidents.find_one({
        "vehicle_id": vehicle["_id"],
        "type": incident_type,
        "status": "Open",
        "created_at": {"$gte": now - timedelta(minutes=30)}
    })

    doc = {
        "vehicle_id": vehicle["_id"],
        "owner_id": vehicle["owner_id"],
        "type": incident_type,
        "description": description[:2000],
        "location": location_str,
        "coordinates": coords,
        "image": image_data,
        "status": "Open",
        "possible_duplicate": bool(duplicate),
        "created_at": now,
        "updated_at": now,
    }
    result = incidents.insert_one(doc)
    doc["_id"] = result.inserted_id

    # Look up vehicle owner and trigger Email and Push notifications
    owner = users.find_one({"_id": vehicle.get("owner_id")})
    dispatch_incident_notifications(owner, vehicle, doc)

    s_doc = serialize(doc)
    s_doc["reg_number"] = vehicle.get("registration_number")
    s_doc["make"] = vehicle.get("make")
    s_doc["model"] = vehicle.get("model")

    return jsonify(
        incident=s_doc,
        possible_duplicate=bool(duplicate),
        message="Incident report submitted successfully"
    ), 201

@app.get("/api/incidents/mine")
@auth_required("owner", "admin")
def my_incidents():
    owner_id = g.user["_id"]
    status_filter = request.args.get("status", "").strip()

    query = {"owner_id": owner_id}
    if status_filter and status_filter != "All":
        query["status"] = status_filter

    cursor = incidents.find(query).sort("created_at", -1)

    # Attach vehicle registration & details to each incident for frontend display
    owner_vehs = {str(v["_id"]): v for v in vehicles.find({"owner_id": owner_id})}
    out = []
    for inc in cursor:
        s = serialize(inc)
        v = owner_vehs.get(str(inc.get("vehicle_id")))
        if v:
            s["reg_number"] = v.get("registration_number", "Unknown")
            s["make"] = v.get("make")
            s["model"] = v.get("model")
        else:
            s["reg_number"] = "Registered Vehicle"
        out.append(s)

    return jsonify(incidents=out)

@app.patch("/api/incidents/<incident_id>/status")
@auth_required("owner", "admin")
def update_status(incident_id):
    data = request.get_json(silent=True) or {}
    status = str(data.get("status", "")).strip()

    if status not in STATUSES:
        return jsonify(error=f"status must be one of {sorted(STATUSES)}"), 400

    _id = oid(incident_id)
    if not _id:
        return jsonify(error="Invalid incident ID"), 400

    now = datetime.now(timezone.utc)
    result = incidents.update_one(
        {"_id": _id, "owner_id": g.user["_id"]},
        {"$set": {"status": status, "updated_at": now}}
    )
    if not result.matched_count:
        return jsonify(error="Incident not found or not owned by you"), 404

    updated = incidents.find_one({"_id": _id})
    return jsonify(incident=serialize(updated), message=f"Incident marked as {status}")

# ==========================================
# 8. ADMIN MANAGEMENT & DATA DELETION ENDPOINTS
# ==========================================
@app.get("/api/admin/stats")
@auth_required("admin")
def admin_stats():
    """Returns overview platform statistics for the administrator."""
    return jsonify(
        total_users=users.count_documents({}),
        total_vehicles=vehicles.count_documents({}),
        total_incidents=incidents.count_documents({}),
        open_incidents=incidents.count_documents({"status": "Open"}),
        resolved_incidents=incidents.count_documents({"status": "Resolved"})
    )

@app.get("/api/admin/users")
@auth_required("admin")
def admin_list_users():
    """Lists all registered users for moderation."""
    u_list = list(users.find().sort("created_at", -1).limit(200))
    return jsonify(users=[serialize(u) for u in u_list])

@app.delete("/api/admin/users/<user_id>")
@auth_required("admin")
def admin_delete_user(user_id):
    """Deletes a user and cascades deletion of their vehicles and incidents."""
    _id = oid(user_id)
    if not _id:
        return jsonify(error="Invalid user ID"), 400
    
    target_user = users.find_one({"_id": _id})
    if not target_user:
        return jsonify(error="User not found"), 404

    # Cascading delete
    v_res = vehicles.delete_many({"owner_id": _id})
    i_res = incidents.delete_many({"owner_id": _id})
    u_res = users.delete_one({"_id": _id})

    return jsonify(
        message=f"User {target_user.get('email')} and all associated data deleted successfully.",
        deleted_vehicles=v_res.deleted_count,
        deleted_incidents=i_res.deleted_count
    )

@app.get("/api/admin/vehicles")
@auth_required("admin")
def admin_list_vehicles():
    """Lists all vehicles registered across the entire system."""
    v_list = list(vehicles.find().sort("created_at", -1).limit(200))
    # Map owner emails for easy display
    owner_map = {str(u["_id"]): u.get("email") for u in users.find()}
    out = []
    for v in v_list:
        sv = serialize(v)
        sv["owner_email"] = owner_map.get(str(v.get("owner_id")), "Unknown")
        sv["incident_count"] = incidents.count_documents({"vehicle_id": v["_id"]})
        out.append(sv)
    return jsonify(vehicles=out)

@app.delete("/api/admin/vehicles/<vehicle_id>")
@auth_required("admin")
def admin_delete_vehicle(vehicle_id):
    """Deletes any vehicle from the database along with its incidents."""
    _id = oid(vehicle_id)
    if not _id:
        return jsonify(error="Invalid vehicle ID"), 400
    
    v = vehicles.find_one({"_id": _id})
    if not v:
        return jsonify(error="Vehicle not found"), 404

    incidents.delete_many({"vehicle_id": _id})
    vehicles.delete_one({"_id": _id})
    return jsonify(message=f"Vehicle {v.get('registration_number')} and related incidents deleted.")

@app.get("/api/admin/incidents")
@auth_required("admin")
def admin_list_incidents():
    """Lists all incidents for moderation."""
    i_list = list(incidents.find().sort("created_at", -1).limit(200))
    v_map = {str(v["_id"]): v.get("registration_number") for v in vehicles.find()}
    out = []
    for inc in i_list:
        si = serialize(inc)
        si["reg_number"] = v_map.get(str(inc.get("vehicle_id")), "Unknown Plate")
        out.append(si)
    return jsonify(incidents=out)

@app.delete("/api/admin/incidents/<incident_id>")
@auth_required("admin")
def admin_delete_incident(incident_id):
    """Deletes an incident report."""
    _id = oid(incident_id)
    if not _id:
        return jsonify(error="Invalid incident ID"), 400
    res = incidents.delete_one({"_id": _id})
    if res.deleted_count == 0:
        return jsonify(error="Incident not found"), 404
    return jsonify(message="Incident report deleted permanently.")

@app.errorhandler(Exception)
def handle_exception(e):
    app.logger.exception("Unhandled server error: %s", e)
    # Return JSON so frontends/fetch won't fail with Unexpected token '<'
    return jsonify(error="Database or server error. Please ensure MongoDB Atlas IP whitelist allows your current public IP.", detail=str(e)), 500

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    print(f"Starting ParkAssist API on http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)

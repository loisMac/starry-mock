const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const STORE_PATH = path.join(__dirname, "data", "store.json");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "runa4upit";
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const EMAIL_FROM = process.env.EMAIL_FROM || "Northline Studio <hello@northlinestudio.se>";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_IGNORE_TLS_ERRORS = String(process.env.SMTP_IGNORE_TLS_ERRORS || "false").toLowerCase() === "true";

const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const CUSTOMER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const CUSTOMER_VERIFY_TTL_MS = 1000 * 60 * 60 * 24;
const CUSTOMER_RESET_TTL_MS = 1000 * 60 * 30;

const adminSessions = new Map();
const customerSessions = new Map();
const customerVerificationTokens = new Map();
const customerResetTokens = new Map();
const mailer = createSmtpTransporter();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    appBaseUrl: APP_BASE_URL,
    emailFrom: EMAIL_FROM,
    smtpEnabled: Boolean(mailer),
    emailMode: mailer ? "smtp" : "preview"
  });
});

app.get("/api/services", (_req, res) => {
  const store = readStore();
  res.json(store.services);
});

app.get("/api/barbers", (_req, res) => {
  const store = readStore();
  res.json(store.barbers);
});

app.get("/api/availability", (req, res) => {
  const { date, barberId, serviceId } = req.query;

  if (!date || !barberId || !serviceId) {
    res.status(400).json({ error: "date, barberId, and serviceId are required" });
    return;
  }

  if (!isValidDateInput(String(date))) {
    res.status(400).json({ error: "date must be in YYYY-MM-DD format" });
    return;
  }

  const store = readStore();
  const service = store.services.find((entry) => entry.id === serviceId);
  const barber = store.barbers.find((entry) => entry.id === barberId);

  if (!service) {
    res.status(404).json({ error: "Service not found" });
    return;
  }

  if (!barber) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }

  const slots = buildAvailability(store, {
    date: String(date),
    barberId: String(barberId),
    serviceDuration: Number(service.duration)
  });

  res.json({
    date,
    barberId,
    serviceId,
    availableCount: slots.filter((slot) => slot.available).length,
    slots
  });
});

app.get("/api/bookings", (req, res) => {
  const store = readStore();
  const date = req.query.date ? String(req.query.date) : null;
  const barberId = req.query.barberId ? String(req.query.barberId) : null;

  const filtered = store.bookings.filter((booking) => {
    if (date && booking.date !== date) {
      return false;
    }

    if (barberId && booking.barberId !== barberId) {
      return false;
    }

    return true;
  });

  res.json(sortBookings(filtered));
});

app.post("/api/bookings", (req, res) => {
  const name = req.body && req.body.name ? String(req.body.name).trim() : "";
  const email = req.body && req.body.email ? String(req.body.email).trim().toLowerCase() : "";
  const phone = req.body && req.body.phone ? String(req.body.phone).trim() : "";
  const serviceId = req.body && req.body.serviceId ? String(req.body.serviceId).trim() : "";
  const barberId = req.body && req.body.barberId ? String(req.body.barberId).trim() : "";
  const date = req.body && req.body.date ? String(req.body.date).trim() : "";
  const time = req.body && req.body.time ? String(req.body.time).trim() : "";

  if (!name || !email || !phone || !serviceId || !barberId || !date || !time) {
    res.status(400).json({ error: "name, email, phone, serviceId, barberId, date, and time are required" });
    return;
  }

  if (!isValidDateInput(date)) {
    res.status(400).json({ error: "date must be in YYYY-MM-DD format" });
    return;
  }

  if (!isValidTimeInput(time)) {
    res.status(400).json({ error: "time must be in HH:MM format" });
    return;
  }

  const store = readStore();
  const service = store.services.find((entry) => entry.id === serviceId);
  const barber = store.barbers.find((entry) => entry.id === barberId);

  if (!service) {
    res.status(404).json({ error: "Service not found" });
    return;
  }

  if (!barber) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }

  const availability = buildAvailability(store, {
    date,
    barberId,
    serviceDuration: Number(service.duration)
  });

  const selectedSlot = availability.find((slot) => slot.time === time);
  if (!selectedSlot || !selectedSlot.available) {
    res.status(409).json({ error: "Selected time is no longer available" });
    return;
  }

  const customer = getCustomerFromToken(req, store);

  const booking = {
    id: createBookingId(),
    name: customer ? customer.name : name,
    email: customer ? customer.email : email,
    phone,
    serviceId,
    serviceName: service.name,
    serviceDuration: Number(service.duration),
    barberId,
    barberName: barber.name,
    date,
    time,
    createdAt: new Date().toISOString(),
    customerId: customer ? customer.id : null
  };

  if (customer && customer.emailVerified) {
    attachLegacyBookingsToCustomer(store, customer);
    booking.customerId = customer.id;
  }

  store.bookings.push(booking);

  queueEmail(store, {
    to: booking.email,
    subject: "Northline Studio booking confirmation",
    template: "booking-confirmation",
    payload: {
      bookingId: booking.id,
      customerName: booking.name,
      serviceName: booking.serviceName,
      barberName: booking.barberName,
      date: booking.date,
      time: booking.time
    }
  });

  writeStore(store);
  res.status(201).json(booking);
});

app.delete("/api/bookings/:id", (req, res) => {
  const store = readStore();
  const booking = store.bookings.find((entry) => entry.id === req.params.id);

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  store.bookings = store.bookings.filter((entry) => entry.id !== req.params.id);

  queueEmail(store, {
    to: booking.email,
    subject: "Northline Studio booking cancelled",
    template: "booking-cancelled",
    payload: {
      bookingId: booking.id,
      customerName: booking.name,
      date: booking.date,
      time: booking.time
    }
  });

  writeStore(store);
  res.status(204).send();
});

app.post("/api/customer/register", (req, res) => {
  const name = req.body && req.body.name ? String(req.body.name).trim() : "";
  const email = req.body && req.body.email ? String(req.body.email).trim().toLowerCase() : "";
  const phone = req.body && req.body.phone ? String(req.body.phone).trim() : "";
  const password = req.body && req.body.password ? String(req.body.password) : "";

  if (!name || !email || !phone || !password) {
    res.status(400).json({ error: "name, email, phone, and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const store = readStore();
  const existingCustomer = store.customers.find((entry) => entry.email === email);

  if (existingCustomer) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const customer = {
    id: createCustomerId(),
    name,
    email,
    phone,
    passwordHash: hashPassword(password),
    emailVerified: false,
    createdAt: new Date().toISOString()
  };

  store.customers.push(customer);
  attachLegacyBookingsToCustomer(store, customer);

  const verificationToken = createEphemeralToken(customerVerificationTokens, {
    customerId: customer.id
  }, CUSTOMER_VERIFY_TTL_MS);

  queueEmail(store, {
    to: customer.email,
    subject: "Verify your Northline Studio account",
    template: "customer-verification",
    payload: {
      customerName: customer.name,
      verifyUrl: `${APP_BASE_URL}/account.html?verify=${verificationToken}`,
      token: verificationToken
    }
  });

  writeStore(store);

  res.status(201).json({
    message: "Account created. Please verify your email before signing in.",
    verificationRequired: true
  });
});

app.post("/api/customer/verify-email", (req, res) => {
  const token = req.body && req.body.token ? String(req.body.token).trim() : "";
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  cleanupExpiredEphemeralTokens(customerVerificationTokens);
  const tokenData = customerVerificationTokens.get(token);
  if (!tokenData) {
    res.status(400).json({ error: "Verification link is invalid or expired" });
    return;
  }

  customerVerificationTokens.delete(token);

  const store = readStore();
  const customer = store.customers.find((entry) => entry.id === tokenData.customerId);
  if (!customer) {
    res.status(404).json({ error: "Customer account not found" });
    return;
  }

  customer.emailVerified = true;
  attachLegacyBookingsToCustomer(store, customer);
  writeStore(store);

  res.json({
    message: "Email verified. You can now sign in.",
    customer: sanitizeCustomer(customer)
  });
});

app.post("/api/customer/resend-verification", (req, res) => {
  const email = req.body && req.body.email ? String(req.body.email).trim().toLowerCase() : "";

  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const store = readStore();
  const customer = store.customers.find((entry) => entry.email === email);

  if (!customer || customer.emailVerified) {
    res.json({ message: "If the account exists and is unverified, a verification email has been sent." });
    return;
  }

  const verificationToken = createEphemeralToken(customerVerificationTokens, {
    customerId: customer.id
  }, CUSTOMER_VERIFY_TTL_MS);

  queueEmail(store, {
    to: customer.email,
    subject: "Verify your Northline Studio account",
    template: "customer-verification",
    payload: {
      customerName: customer.name,
      verifyUrl: `${APP_BASE_URL}/account.html?verify=${verificationToken}`,
      token: verificationToken
    }
  });

  writeStore(store);

  res.json({ message: "If the account exists and is unverified, a verification email has been sent." });
});

app.post("/api/customer/request-password-reset", (req, res) => {
  const email = req.body && req.body.email ? String(req.body.email).trim().toLowerCase() : "";
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const store = readStore();
  const customer = store.customers.find((entry) => entry.email === email);

  if (customer) {
    const resetToken = createEphemeralToken(customerResetTokens, {
      customerId: customer.id
    }, CUSTOMER_RESET_TTL_MS);

    queueEmail(store, {
      to: customer.email,
      subject: "Reset your Northline Studio password",
      template: "customer-password-reset",
      payload: {
        customerName: customer.name,
        resetUrl: `${APP_BASE_URL}/account.html?reset=${resetToken}`,
        token: resetToken
      }
    });

    writeStore(store);
  }

  res.json({ message: "If the account exists, a password reset link has been sent." });
});

app.post("/api/customer/reset-password", (req, res) => {
  const token = req.body && req.body.token ? String(req.body.token).trim() : "";
  const password = req.body && req.body.password ? String(req.body.password) : "";

  if (!token || !password) {
    res.status(400).json({ error: "token and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  cleanupExpiredEphemeralTokens(customerResetTokens);
  const tokenData = customerResetTokens.get(token);

  if (!tokenData) {
    res.status(400).json({ error: "Reset link is invalid or expired" });
    return;
  }

  customerResetTokens.delete(token);

  const store = readStore();
  const customer = store.customers.find((entry) => entry.id === tokenData.customerId);

  if (!customer) {
    res.status(404).json({ error: "Customer account not found" });
    return;
  }

  customer.passwordHash = hashPassword(password);
  writeStore(store);

  res.json({ message: "Password updated successfully. You can now sign in." });
});

app.post("/api/customer/login", (req, res) => {
  const email = req.body && req.body.email ? String(req.body.email).trim().toLowerCase() : "";
  const password = req.body && req.body.password ? String(req.body.password) : "";

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const store = readStore();
  const customer = store.customers.find((entry) => entry.email === email);

  if (!customer || !verifyPassword(password, customer.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (!customer.emailVerified) {
    res.status(403).json({ error: "Please verify your email before signing in" });
    return;
  }

  attachLegacyBookingsToCustomer(store, customer);
  writeStore(store);

  const session = createCustomerSession(customer.id);
  res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    customer: sanitizeCustomer(customer)
  });
});

app.use("/api/customer", requireCustomerAuth);

app.get("/api/customer/session", (req, res) => {
  res.json({ ok: true, customer: sanitizeCustomer(req.customer) });
});

app.post("/api/customer/logout", (req, res) => {
  customerSessions.delete(req.customerToken);
  res.status(204).send();
});

app.get("/api/customer/me", (req, res) => {
  res.json(sanitizeCustomer(req.customer));
});

app.get("/api/customer/bookings", (req, res) => {
  const store = readStore();
  const bookings = store.bookings.filter((entry) => entry.customerId === req.customer.id);
  res.json(sortBookings(bookings));
});

app.delete("/api/customer/bookings/:id", (req, res) => {
  const store = readStore();
  const booking = store.bookings.find((entry) => entry.id === req.params.id);

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  if (booking.customerId !== req.customer.id) {
    res.status(403).json({ error: "Booking does not belong to this account" });
    return;
  }

  store.bookings = store.bookings.filter((entry) => entry.id !== req.params.id);

  queueEmail(store, {
    to: booking.email,
    subject: "Northline Studio booking cancelled",
    template: "booking-cancelled",
    payload: {
      bookingId: booking.id,
      customerName: booking.name,
      date: booking.date,
      time: booking.time
    }
  });

  writeStore(store);
  res.status(204).send();
});

app.post("/api/admin/login", (req, res) => {
  const password = req.body && req.body.password ? String(req.body.password) : "";

  if (!password) {
    res.status(400).json({ error: "password is required" });
    return;
  }

  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid admin password" });
    return;
  }

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  adminSessions.set(token, { expiresAt });

  res.json({ token, expiresAt });
});

app.use("/api/admin", requireAdminAuth);

app.get("/api/admin/session", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  adminSessions.delete(req.adminToken);
  res.status(204).send();
});

app.get("/api/admin/overview", (req, res) => {
  const store = readStore();
  const date = req.query.date ? String(req.query.date) : null;
  const barberId = req.query.barberId ? String(req.query.barberId) : null;

  let bookings = store.bookings;

  if (date) {
    bookings = bookings.filter((entry) => entry.date === date);
  }

  if (barberId) {
    bookings = bookings.filter((entry) => entry.barberId === barberId);
  }

  res.json({
    date,
    barberId,
    totalBookings: bookings.length,
    bookings: sortBookings(bookings)
  });
});

app.get("/api/admin/schedule", (req, res) => {
  const date = req.query.date ? String(req.query.date) : "";
  const barberId = req.query.barberId ? String(req.query.barberId) : "";

  if (!date || !barberId) {
    res.status(400).json({ error: "date and barberId are required" });
    return;
  }

  if (!isValidDateInput(date)) {
    res.status(400).json({ error: "date must be in YYYY-MM-DD format" });
    return;
  }

  const store = readStore();
  const schedule = getEffectiveSchedule(store, date, barberId);
  res.json({ date, barberId, schedule });
});

app.put("/api/admin/schedule", (req, res) => {
  const date = req.body && req.body.date ? String(req.body.date).trim() : "";
  const barberId = req.body && req.body.barberId ? String(req.body.barberId).trim() : "";
  const startHour = req.body ? Number(req.body.startHour) : NaN;
  const closeHour = req.body ? Number(req.body.closeHour) : NaN;
  const blockedSlots = req.body && Array.isArray(req.body.blockedSlots) ? req.body.blockedSlots : [];

  if (!date || !barberId || Number.isNaN(startHour) || Number.isNaN(closeHour)) {
    res.status(400).json({ error: "date, barberId, startHour, and closeHour are required" });
    return;
  }

  if (!isValidDateInput(date)) {
    res.status(400).json({ error: "date must be in YYYY-MM-DD format" });
    return;
  }

  if (!Number.isInteger(startHour) || !Number.isInteger(closeHour) || startHour < 0 || closeHour > 24 || startHour >= closeHour) {
    res.status(400).json({ error: "startHour and closeHour must be integers where 0 <= startHour < closeHour <= 24" });
    return;
  }

  const store = readStore();
  const barber = store.barbers.find((entry) => entry.id === barberId);
  if (!barber) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }

  const key = createScheduleKey(date, barberId);
  store.scheduleOverrides[key] = {
    startHour,
    closeHour,
    blockedSlots: sanitizeBlockedSlots(blockedSlots)
  };

  writeStore(store);
  res.json({ date, barberId, schedule: store.scheduleOverrides[key] });
});

app.delete("/api/admin/schedule", (req, res) => {
  const date = req.query.date ? String(req.query.date) : "";
  const barberId = req.query.barberId ? String(req.query.barberId) : "";

  if (!date || !barberId) {
    res.status(400).json({ error: "date and barberId are required" });
    return;
  }

  const store = readStore();
  const key = createScheduleKey(date, barberId);

  if (!store.scheduleOverrides[key]) {
    res.status(404).json({ error: "No override found" });
    return;
  }

  delete store.scheduleOverrides[key];
  writeStore(store);
  res.status(204).send();
});

app.delete("/api/admin/bookings/:id", (req, res) => {
  const store = readStore();
  const booking = store.bookings.find((entry) => entry.id === req.params.id);

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  store.bookings = store.bookings.filter((entry) => entry.id !== req.params.id);

  queueEmail(store, {
    to: booking.email,
    subject: "Northline Studio booking cancelled",
    template: "booking-cancelled",
    payload: {
      bookingId: booking.id,
      customerName: booking.name,
      date: booking.date,
      time: booking.time
    }
  });

  writeStore(store);
  res.status(204).send();
});

app.get("/api/admin/email-outbox", (_req, res) => {
  const store = readStore();
  const outbox = [...store.emailOutbox].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  res.json({ total: outbox.length, items: outbox.slice(0, 200) });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Northline Studio server running on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Email mode: ${mailer ? `SMTP (${SMTP_HOST}:${SMTP_PORT})` : "preview outbox only"}`);
});

function readStore() {
  const raw = fs.readFileSync(STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  return ensureStoreShape(parsed);
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

function ensureStoreShape(raw) {
  const base = raw && typeof raw === "object" ? raw : {};

  const config = {
    openHour: Number(base.config && base.config.openHour) || 9,
    closeHour: Number(base.config && base.config.closeHour) || 20,
    slotMinutes: Number(base.config && base.config.slotMinutes) || 30
  };

  const services = Array.isArray(base.services) ? base.services : [];
  const barbers = Array.isArray(base.barbers) ? base.barbers : [];
  const bookings = Array.isArray(base.bookings)
    ? base.bookings.map((booking) => ({
        ...booking,
        customerId: booking.customerId || null
      }))
    : [];

  const scheduleOverrides = base.scheduleOverrides && typeof base.scheduleOverrides === "object"
    ? base.scheduleOverrides
    : {};

  const customers = Array.isArray(base.customers)
    ? base.customers.map((customer) => ({
        ...customer,
        email: String(customer.email || "").trim().toLowerCase(),
        emailVerified: Boolean(customer.emailVerified)
      }))
    : [];

  const emailOutbox = Array.isArray(base.emailOutbox) ? base.emailOutbox : [];

  return {
    config,
    services,
    barbers,
    bookings,
    scheduleOverrides,
    customers,
    emailOutbox
  };
}

function queueEmail(store, email) {
  const entry = {
    id: createEmailId(),
    from: EMAIL_FROM,
    to: email.to,
    subject: email.subject,
    template: email.template,
    payload: email.payload || {},
    status: mailer ? "queued" : "preview",
    provider: mailer ? "smtp" : "preview",
    createdAt: new Date().toISOString()
  };

  store.emailOutbox.push(entry);

  if (mailer) {
    sendOutboxEmail(entry);
  }
}

function createSmtpTransporter() {
  if (!SMTP_HOST) {
    return null;
  }

  const transporterConfig = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE
  };

  if (SMTP_USER) {
    transporterConfig.auth = {
      user: SMTP_USER,
      pass: SMTP_PASS
    };
  }

  if (SMTP_IGNORE_TLS_ERRORS) {
    transporterConfig.tls = {
      rejectUnauthorized: false
    };
  }

  return nodemailer.createTransport(transporterConfig);
}

function sendOutboxEmail(entry) {
  const content = buildEmailContent(entry);
  const mailOptions = {
    from: entry.from || EMAIL_FROM,
    to: entry.to,
    subject: entry.subject,
    text: content.text,
    html: content.html
  };

  mailer.sendMail(mailOptions, (error, info) => {
    const store = readStore();
    const outboxItem = store.emailOutbox.find((item) => item.id === entry.id);
    if (!outboxItem) {
      return;
    }

    if (error) {
      outboxItem.status = "failed";
      outboxItem.error = error.message;
      outboxItem.failedAt = new Date().toISOString();
    } else {
      outboxItem.status = "sent";
      outboxItem.providerMessageId = info && info.messageId ? info.messageId : null;
      outboxItem.sentAt = new Date().toISOString();
    }

    writeStore(store);
  });
}

function buildEmailContent(entry) {
  const payload = entry.payload || {};

  if (entry.template === "customer-verification") {
    const verifyUrl = payload.verifyUrl || `${APP_BASE_URL}/account.html`;
    return {
      text: [
        `Hi ${payload.customerName || "there"},`,
        "",
        "Please verify your Northline Studio account:",
        verifyUrl,
        "",
        "If you did not request this, you can ignore this email."
      ].join("\n"),
      html: `<p>Hi ${escapeHtml(payload.customerName || "there")},</p><p>Please verify your Northline Studio account:</p><p><a href="${escapeHtml(verifyUrl)}">Verify your email</a></p><p>If you did not request this, you can ignore this email.</p>`
    };
  }

  if (entry.template === "customer-password-reset") {
    const resetUrl = payload.resetUrl || `${APP_BASE_URL}/account.html`;
    return {
      text: [
        `Hi ${payload.customerName || "there"},`,
        "",
        "Reset your Northline Studio password:",
        resetUrl,
        "",
        "This link expires shortly."
      ].join("\n"),
      html: `<p>Hi ${escapeHtml(payload.customerName || "there")},</p><p>Reset your Northline Studio password:</p><p><a href="${escapeHtml(resetUrl)}">Reset password</a></p><p>This link expires shortly.</p>`
    };
  }

  if (entry.template === "booking-confirmation") {
    const summary = `${payload.date || ""} ${payload.time || ""}`.trim();
    return {
      text: [
        `Hi ${payload.customerName || "there"},`,
        "",
        "Your booking is confirmed.",
        `${payload.serviceName || "Service"} with ${payload.barberName || "your barber"}`,
        summary,
        `Reference: ${payload.bookingId || "-"}`
      ].join("\n"),
      html: `<p>Hi ${escapeHtml(payload.customerName || "there")},</p><p>Your booking is confirmed.</p><p><strong>${escapeHtml(payload.serviceName || "Service")}</strong> with ${escapeHtml(payload.barberName || "your barber")}</p><p>${escapeHtml(summary)}</p><p>Reference: ${escapeHtml(payload.bookingId || "-")}</p>`
    };
  }

  if (entry.template === "booking-cancelled") {
    const summary = `${payload.date || ""} ${payload.time || ""}`.trim();
    return {
      text: [
        `Hi ${payload.customerName || "there"},`,
        "",
        "Your booking has been cancelled.",
        summary,
        `Reference: ${payload.bookingId || "-"}`
      ].join("\n"),
      html: `<p>Hi ${escapeHtml(payload.customerName || "there")},</p><p>Your booking has been cancelled.</p><p>${escapeHtml(summary)}</p><p>Reference: ${escapeHtml(payload.bookingId || "-")}</p>`
    };
  }

  return {
    text: entry.subject,
    html: `<p>${escapeHtml(entry.subject)}</p>`
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createBookingId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `NL-${stamp}-${random}`;
}

function createCustomerId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `CU-${stamp}-${random}`;
}

function createEmailId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `MAIL-${stamp}-${random}`;
}

function createScheduleKey(date, barberId) {
  return `${date}::${barberId}`;
}

function getEffectiveSchedule(store, date, barberId) {
  const key = createScheduleKey(date, barberId);
  const base = {
    startHour: store.config.openHour,
    closeHour: store.config.closeHour,
    blockedSlots: []
  };

  if (!store.scheduleOverrides[key]) {
    return base;
  }

  const override = store.scheduleOverrides[key];
  return {
    startHour: Number(override.startHour),
    closeHour: Number(override.closeHour),
    blockedSlots: sanitizeBlockedSlots(override.blockedSlots)
  };
}

function sanitizeBlockedSlots(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((slot) => String(slot).trim())
    .filter((slot) => /^\d{2}:\d{2}$/.test(slot));

  return [...new Set(normalized)].sort();
}

function buildAvailability(store, { date, barberId, serviceDuration }) {
  const schedule = getEffectiveSchedule(store, date, barberId);
  const dayBookings = store.bookings.filter((entry) => entry.date === date && entry.barberId === barberId);

  const openMinutes = schedule.startHour * 60;
  const closeMinutes = schedule.closeHour * 60;
  const slotMinutes = Number(store.config.slotMinutes) || 30;

  const slots = [];

  for (let start = openMinutes; start + serviceDuration <= closeMinutes; start += slotMinutes) {
    const end = start + serviceDuration;
    const time = minutesToTime(start);

    const isBlocked = schedule.blockedSlots.includes(time);

    const overlapsBooking = dayBookings.some((booking) => {
      const bookingStart = timeToMinutes(booking.time);
      const bookingEnd = bookingStart + Number(booking.serviceDuration || slotMinutes);
      return start < bookingEnd && bookingStart < end;
    });

    slots.push({
      time,
      available: !isBlocked && !overlapsBooking
    });
  }

  return slots;
}

function minutesToTime(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeToMinutes(time) {
  const [hourRaw, minuteRaw] = String(time).split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  return hour * 60 + minute;
}

function isValidDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTimeInput(value) {
  return /^\d{2}:\d{2}$/.test(value);
}

function sortBookings(bookings) {
  return [...bookings].sort((a, b) => {
    const aKey = `${a.date}T${a.time}:00`;
    const bKey = `${b.date}T${b.time}:00`;
    return Date.parse(aKey) - Date.parse(bKey);
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) {
    return false;
  }

  const [salt, digest] = storedHash.split(":");
  const computed = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");

  const digestBuffer = Buffer.from(digest, "hex");
  const computedBuffer = Buffer.from(computed, "hex");
  if (digestBuffer.length !== computedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(digestBuffer, computedBuffer);
}

function sanitizeCustomer(customer) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    emailVerified: Boolean(customer.emailVerified),
    createdAt: customer.createdAt
  };
}

function createCustomerSession(customerId) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + CUSTOMER_SESSION_TTL_MS;
  customerSessions.set(token, { customerId, expiresAt });
  return { token, expiresAt };
}

function createEphemeralToken(storeMap, payload, ttlMs) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + ttlMs;
  storeMap.set(token, { ...payload, expiresAt });
  return token;
}

function cleanupExpiredEphemeralTokens(storeMap) {
  const now = Date.now();
  for (const [token, entry] of storeMap.entries()) {
    if (entry.expiresAt <= now) {
      storeMap.delete(token);
    }
  }
}

function getCustomerToken(req) {
  const customHeader = req.header("x-customer-token");
  if (customHeader) {
    return customHeader;
  }

  const authHeader = req.header("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  return "";
}

function getAdminToken(req) {
  const customHeader = req.header("x-admin-token");
  if (customHeader) {
    return customHeader;
  }

  const authHeader = req.header("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  return "";
}

function getCustomerFromToken(req, store) {
  const token = getCustomerToken(req);
  if (!token) {
    return null;
  }

  const session = customerSessions.get(token);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    customerSessions.delete(token);
    return null;
  }

  return store.customers.find((entry) => entry.id === session.customerId) || null;
}

function requireCustomerAuth(req, res, next) {
  const token = getCustomerToken(req);
  if (!token) {
    res.status(401).json({ error: "Customer authentication required" });
    return;
  }

  const session = customerSessions.get(token);
  if (!session) {
    res.status(401).json({ error: "Session invalid or expired" });
    return;
  }

  if (session.expiresAt <= Date.now()) {
    customerSessions.delete(token);
    res.status(401).json({ error: "Session expired" });
    return;
  }

  const store = readStore();
  const customer = store.customers.find((entry) => entry.id === session.customerId);
  if (!customer) {
    customerSessions.delete(token);
    res.status(401).json({ error: "Customer not found" });
    return;
  }

  req.customer = customer;
  req.customerToken = token;
  next();
}

function requireAdminAuth(req, res, next) {
  const token = getAdminToken(req);
  if (!token) {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }

  const session = adminSessions.get(token);
  if (!session) {
    res.status(401).json({ error: "Session invalid or expired" });
    return;
  }

  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    res.status(401).json({ error: "Session expired" });
    return;
  }

  req.adminToken = token;
  next();
}

function attachLegacyBookingsToCustomer(store, customer) {
  if (!customer || !customer.email) {
    return;
  }

  const normalizedEmail = String(customer.email).trim().toLowerCase();

  store.bookings.forEach((booking) => {
    const bookingEmail = String(booking.email || "").trim().toLowerCase();
    if (!booking.customerId && bookingEmail === normalizedEmail) {
      booking.customerId = customer.id;
    }
  });
}

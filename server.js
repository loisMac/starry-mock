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
const EMAIL_FROM = process.env.EMAIL_FROM || "Northline Studio <hello@northlinestudio.co.uk>";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_IGNORE_TLS_ERRORS = String(process.env.SMTP_IGNORE_TLS_ERRORS || "false").toLowerCase() === "true";
const SUPPORT_EMAIL = "hello@northlinestudio.co.uk";
const SUPPORT_PHONE = "+44 20 7946 1741";

const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const STAFF_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const CUSTOMER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const CUSTOMER_VERIFY_TTL_MS = 1000 * 60 * 60 * 24;
const CUSTOMER_RESET_TTL_MS = 1000 * 60 * 30;
const STAFF_SEED_PASSWORD = process.env.STAFF_SEED_PASSWORD || "northline-staff";

const adminSessions = new Map();
const staffSessions = new Map();
const customerSessions = new Map();
const customerVerificationTokens = new Map();
const customerResetTokens = new Map();
const mailer = createSmtpTransporter();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Allow the page to be opened from file:// or any localhost origin
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const isAllowed =
    !origin ||
    origin === "null" ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-admin-token,x-staff-token,x-customer-token");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

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
    subject: `You're booked in: ${booking.date} at ${booking.time}`,
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
    subject: `Your booking has been cancelled: ${booking.date} at ${booking.time}`,
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
    subject: "Just one quick step: verify your Northline Studio account",
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
    subject: "Just one quick step: verify your Northline Studio account",
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
      subject: "Password reset link for your Northline Studio account",
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

app.post("/api/staff/login", (req, res) => {
  const email = req.body && req.body.email ? String(req.body.email).trim().toLowerCase() : "";
  const password = req.body && req.body.password ? String(req.body.password) : "";

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const store = readStore();
  const staffAccount = store.staffAccounts.find((entry) => entry.email === email);

  if (!staffAccount || !verifyPassword(password, staffAccount.passwordHash)) {
    res.status(401).json({ error: "Invalid staff email or password" });
    return;
  }

  const barber = store.barbers.find((entry) => entry.id === staffAccount.barberId);
  if (!barber) {
    res.status(404).json({ error: "Assigned barber not found" });
    return;
  }

  const session = createStaffSession(staffAccount.id);
  res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    staff: sanitizeStaffAccount(staffAccount, barber)
  });
});

app.use("/api/customer", requireCustomerAuth);

app.use("/api/staff", requireStaffAuth);

app.get("/api/customer/session", (req, res) => {
  res.json({ ok: true, customer: sanitizeCustomer(req.customer) });
});

app.get("/api/staff/session", (req, res) => {
  res.json({ ok: true, staff: sanitizeStaffAccount(req.staffAccount, req.staffBarber) });
});

app.post("/api/customer/logout", (req, res) => {
  customerSessions.delete(req.customerToken);
  res.status(204).send();
});

app.post("/api/staff/logout", (req, res) => {
  staffSessions.delete(req.staffToken);
  res.status(204).send();
});

app.get("/api/customer/me", (req, res) => {
  res.json(sanitizeCustomer(req.customer));
});

app.get("/api/staff/me", (req, res) => {
  res.json(sanitizeStaffAccount(req.staffAccount, req.staffBarber));
});

app.get("/api/staff/schedule", (req, res) => {
  const date = req.query.date ? String(req.query.date) : "";

  if (!date) {
    res.status(400).json({ error: "date is required" });
    return;
  }

  if (!isValidDateInput(date)) {
    res.status(400).json({ error: "date must be in YYYY-MM-DD format" });
    return;
  }

  const store = readStore();
  const schedule = getEffectiveSchedule(store, date, req.staffBarber.id);
  res.json({ date, barberId: req.staffBarber.id, schedule });
});

app.put("/api/staff/schedule", (req, res) => {
  const date = req.body && req.body.date ? String(req.body.date).trim() : "";
  const startHour = req.body ? Number(req.body.startHour) : NaN;
  const closeHour = req.body ? Number(req.body.closeHour) : NaN;
  const blockedSlots = req.body && Array.isArray(req.body.blockedSlots) ? req.body.blockedSlots : [];

  const result = saveDateOverride({
    store: readStore(),
    barberId: req.staffBarber.id,
    date,
    startHour,
    closeHour,
    blockedSlots
  });

  if (result.error) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  writeStore(result.store);
  res.json({ date, barberId: req.staffBarber.id, schedule: result.schedule });
});

app.delete("/api/staff/schedule", (req, res) => {
  const date = req.query.date ? String(req.query.date) : "";

  if (!date) {
    res.status(400).json({ error: "date is required" });
    return;
  }

  const store = readStore();
  const key = createScheduleKey(date, req.staffBarber.id);

  if (!store.scheduleOverrides[key]) {
    res.status(404).json({ error: "No override found" });
    return;
  }

  delete store.scheduleOverrides[key];
  writeStore(store);
  res.status(204).send();
});

app.get("/api/staff/recurring-schedule", (req, res) => {
  const store = readStore();
  res.json({
    barberId: req.staffBarber.id,
    schedules: getRecurringScheduleSummary(store, req.staffBarber.id)
  });
});

app.put("/api/staff/recurring-schedule", (req, res) => {
  const store = readStore();
  const result = saveRecurringSchedule({
    store,
    barberId: req.staffBarber.id,
    weekdays: req.body && Array.isArray(req.body.weekdays) ? req.body.weekdays : [],
    startHour: req.body ? Number(req.body.startHour) : NaN,
    closeHour: req.body ? Number(req.body.closeHour) : NaN,
    lunchStart: req.body && req.body.lunchStart ? String(req.body.lunchStart).trim() : "",
    lunchEnd: req.body && req.body.lunchEnd ? String(req.body.lunchEnd).trim() : ""
  });

  if (result.error) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  writeStore(store);
  res.json({ barberId: req.staffBarber.id, schedules: getRecurringScheduleSummary(store, req.staffBarber.id) });
});

app.delete("/api/staff/recurring-schedule", (req, res) => {
  const weekday = req.query.weekday !== undefined ? Number(req.query.weekday) : NaN;

  if (Number.isNaN(weekday) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    res.status(400).json({ error: "weekday query param must be 0–6" });
    return;
  }

  const store = readStore();
  const key = createRecurringScheduleKey(req.staffBarber.id, weekday);
  delete store.weeklySchedules[key];
  writeStore(store);
  res.json({ barberId: req.staffBarber.id, schedules: getRecurringScheduleSummary(store, req.staffBarber.id) });
});

app.put("/api/staff/password", (req, res) => {
  const currentPassword = req.body && req.body.currentPassword ? String(req.body.currentPassword) : "";
  const newPassword = req.body && req.body.newPassword ? String(req.body.newPassword) : "";

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ error: "newPassword must be at least 8 characters" });
    return;
  }

  if (!verifyPassword(currentPassword, req.staffAccount.passwordHash)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const store = readStore();
  const account = store.staffAccounts.find((entry) => entry.id === req.staffAccount.id);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  account.passwordHash = hashPassword(newPassword);
  account.isSeedAccount = false;
  writeStore(store);
  res.json({ ok: true });
});

app.get("/api/staff/schedule-month", (req, res) => {
  const year = req.query.year ? Number(req.query.year) : NaN;
  const month = req.query.month ? Number(req.query.month) : NaN;

  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    res.status(400).json({ error: "year and month (1–12) are required" });
    return;
  }

  const store = readStore();
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const sched = getEffectiveSchedule(store, date, req.staffBarber.id);
    days.push({ date, isDayOff: Boolean(sched.isDayOff), source: sched.source || "default", label: sched.label || null });
  }

  res.json({ barberId: req.staffBarber.id, year, month, days });
});

app.get("/api/staff/time-off", (req, res) => {
  const store = readStore();
  res.json({ items: getTimeOffForBarber(store, req.staffBarber.id) });
});

app.post("/api/staff/time-off", (req, res) => {
  const store = readStore();
  const result = addTimeOffRange({
    store,
    barberId: req.staffBarber.id,
    startDate: req.body && req.body.startDate ? String(req.body.startDate).trim() : "",
    endDate: req.body && req.body.endDate ? String(req.body.endDate).trim() : "",
    label: req.body && req.body.label ? String(req.body.label).trim() : "Holiday"
  });

  if (result.error) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  writeStore(store);
  res.status(201).json(result.item);
});

app.delete("/api/staff/time-off/:id", (req, res) => {
  const store = readStore();
  const index = store.timeOff.findIndex((entry) => entry.id === req.params.id && entry.barberId === req.staffBarber.id);

  if (index === -1) {
    res.status(404).json({ error: "Holiday block not found" });
    return;
  }

  store.timeOff.splice(index, 1);
  writeStore(store);
  res.status(204).send();
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
    subject: `Your booking has been cancelled: ${booking.date} at ${booking.time}`,
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

app.get("/api/admin/recurring-schedule", (req, res) => {
  const barberId = req.query.barberId ? String(req.query.barberId) : "";

  if (!barberId) {
    res.status(400).json({ error: "barberId is required" });
    return;
  }

  const store = readStore();
  const barber = store.barbers.find((entry) => entry.id === barberId);
  if (!barber) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }

  res.json({ barberId, schedules: getRecurringScheduleSummary(store, barberId) });
});

app.put("/api/admin/recurring-schedule", (req, res) => {
  const barberId = req.body && req.body.barberId ? String(req.body.barberId).trim() : "";

  if (!barberId) {
    res.status(400).json({ error: "barberId is required" });
    return;
  }

  const store = readStore();
  const barber = store.barbers.find((entry) => entry.id === barberId);
  if (!barber) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }

  const result = saveRecurringSchedule({
    store,
    barberId,
    weekdays: req.body && Array.isArray(req.body.weekdays) ? req.body.weekdays : [],
    startHour: req.body ? Number(req.body.startHour) : NaN,
    closeHour: req.body ? Number(req.body.closeHour) : NaN,
    lunchStart: req.body && req.body.lunchStart ? String(req.body.lunchStart).trim() : "",
    lunchEnd: req.body && req.body.lunchEnd ? String(req.body.lunchEnd).trim() : ""
  });

  if (result.error) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  writeStore(store);
  res.json({ barberId, schedules: getRecurringScheduleSummary(store, barberId) });
});

app.delete("/api/admin/recurring-schedule", (req, res) => {
  const barberId = req.query.barberId ? String(req.query.barberId) : "";
  const weekday = req.query.weekday !== undefined ? Number(req.query.weekday) : NaN;

  if (!barberId) {
    res.status(400).json({ error: "barberId is required" });
    return;
  }

  if (Number.isNaN(weekday) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    res.status(400).json({ error: "weekday query param must be 0–6" });
    return;
  }

  const store = readStore();
  const barber = store.barbers.find((entry) => entry.id === barberId);
  if (!barber) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }

  const key = createRecurringScheduleKey(barberId, weekday);
  delete store.weeklySchedules[key];
  writeStore(store);
  res.json({ barberId, schedules: getRecurringScheduleSummary(store, barberId) });
});

app.get("/api/admin/schedule-month", (req, res) => {
  const barberId = req.query.barberId ? String(req.query.barberId) : "";
  const year = req.query.year ? Number(req.query.year) : NaN;
  const month = req.query.month ? Number(req.query.month) : NaN;

  if (!barberId) {
    res.status(400).json({ error: "barberId is required" });
    return;
  }

  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    res.status(400).json({ error: "year and month (1–12) are required" });
    return;
  }

  const store = readStore();
  const barber = store.barbers.find((entry) => entry.id === barberId);
  if (!barber) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const days = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const sched = getEffectiveSchedule(store, date, barberId);
    days.push({ date, isDayOff: Boolean(sched.isDayOff), source: sched.source || "default", label: sched.label || null });
  }

  res.json({ barberId, year, month, days });
});

app.get("/api/admin/time-off", (req, res) => {
  const barberId = req.query.barberId ? String(req.query.barberId) : "";

  if (!barberId) {
    res.status(400).json({ error: "barberId is required" });
    return;
  }

  const store = readStore();
  res.json({ items: getTimeOffForBarber(store, barberId) });
});

app.post("/api/admin/time-off", (req, res) => {
  const barberId = req.body && req.body.barberId ? String(req.body.barberId).trim() : "";

  if (!barberId) {
    res.status(400).json({ error: "barberId is required" });
    return;
  }

  const store = readStore();
  const barber = store.barbers.find((entry) => entry.id === barberId);
  if (!barber) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }

  const result = addTimeOffRange({
    store,
    barberId,
    startDate: req.body && req.body.startDate ? String(req.body.startDate).trim() : "",
    endDate: req.body && req.body.endDate ? String(req.body.endDate).trim() : "",
    label: req.body && req.body.label ? String(req.body.label).trim() : "Holiday"
  });

  if (result.error) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  writeStore(store);
  res.status(201).json(result.item);
});

app.delete("/api/admin/time-off/:id", (req, res) => {
  const store = readStore();
  const index = store.timeOff.findIndex((entry) => entry.id === req.params.id);

  if (index === -1) {
    res.status(404).json({ error: "Holiday block not found" });
    return;
  }

  store.timeOff.splice(index, 1);
  writeStore(store);
  res.status(204).send();
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
    subject: `Your booking has been cancelled: ${booking.date} at ${booking.time}`,
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

  const weeklySchedules = base.weeklySchedules && typeof base.weeklySchedules === "object"
    ? base.weeklySchedules
    : {};

  const timeOff = Array.isArray(base.timeOff)
    ? base.timeOff.map((entry) => ({
        id: String(entry.id || createTimeOffId()),
        barberId: String(entry.barberId || "").trim(),
        startDate: String(entry.startDate || "").trim(),
        endDate: String(entry.endDate || "").trim(),
        label: String(entry.label || "Holiday").trim() || "Holiday"
      }))
    : [];

  const customers = Array.isArray(base.customers)
    ? base.customers.map((customer) => ({
        ...customer,
        email: String(customer.email || "").trim().toLowerCase(),
        emailVerified: Boolean(customer.emailVerified)
      }))
    : [];

  const emailOutbox = Array.isArray(base.emailOutbox) ? base.emailOutbox : [];

  const staffAccounts = Array.isArray(base.staffAccounts) && base.staffAccounts.length
    ? base.staffAccounts.map((account) => ({
        ...account,
        email: String(account.email || "").trim().toLowerCase()
      }))
    : services.length || barbers.length
      ? barbers.map((barber) => ({
          id: `STAFF-${barber.id.toUpperCase()}`,
          barberId: barber.id,
          name: barber.name,
          email: `${barber.id}@northlinestudio.co.uk`,
          passwordHash: hashPassword(STAFF_SEED_PASSWORD),
          createdAt: new Date().toISOString(),
          isSeedAccount: true
        }))
      : [];

  return {
    config,
    services,
    barbers,
    bookings,
    scheduleOverrides,
    weeklySchedules,
    timeOff,
    customers,
    staffAccounts,
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
  const supportLine = `Need help? ${SUPPORT_EMAIL} | ${SUPPORT_PHONE}`;
  const textSignoff = ["", "Thanks a lot,", "Northline Studio Customer Care", supportLine].join("\n");
  const htmlSignoff = `<p>Thanks a lot,<br />Northline Studio Customer Care<br /><a href=\"mailto:${escapeHtml(SUPPORT_EMAIL)}\">${escapeHtml(SUPPORT_EMAIL)}</a> | ${escapeHtml(SUPPORT_PHONE)}</p>`;

  if (entry.template === "customer-verification") {
    const verifyUrl = payload.verifyUrl || `${APP_BASE_URL}/account.html`;
    return {
      text: [
        `Hi ${payload.customerName || "there"},`,
        "",
        "Thanks for setting up your Northline Studio account.",
        "When you get a moment, please verify your email so your portal is fully active.",
        "",
        "Verify your email:",
        `${verifyUrl}`,
        "",
        "For security, this link expires in 24 hours.",
        "If this was not you, just ignore this message and no changes will be made."
      ].join("\n") + textSignoff,
      html: [
        `<p>Hi ${escapeHtml(payload.customerName || "there")},</p>`,
        "<p>Thanks for setting up your Northline Studio account.</p>",
        "<p>When you get a moment, please verify your email so your portal is fully active.</p>",
        `<p><a href=\"${escapeHtml(verifyUrl)}\">Verify your email address</a></p>`,
        "<p><strong>Security note:</strong> this link expires in 24 hours.</p>",
        "<p>If this was not you, just ignore this message and no changes will be made.</p>",
        htmlSignoff
      ].join("\n"),
    };
  }

  if (entry.template === "customer-password-reset") {
    const resetUrl = payload.resetUrl || `${APP_BASE_URL}/account.html`;
    return {
      text: [
        `Hi ${payload.customerName || "there"},`,
        "",
        "We received a request to reset your password.",
        "",
        "Reset your password:",
        `${resetUrl}`,
        "",
        "This link expires in 30 minutes.",
        "If you did not request this reset, no worries. You can ignore this and your password will stay the same."
      ].join("\n") + textSignoff,
      html: [
        `<p>Hi ${escapeHtml(payload.customerName || "there")},</p>`,
        "<p>We received a request to reset your password.</p>",
        `<p><a href=\"${escapeHtml(resetUrl)}\">Reset your password</a></p>`,
        "<p><strong>Security note:</strong> this reset link expires in 30 minutes.</p>",
        "<p>If you did not request this reset, no worries. You can ignore this and your password will remain unchanged.</p>",
        htmlSignoff
      ].join("\n"),
    };
  }

  if (entry.template === "booking-confirmation") {
    const summary = `${payload.date || ""} ${payload.time || ""}`.trim();
    return {
      text: [
        `Hi ${payload.customerName || "there"},`,
        "",
        "Great news, your appointment is all set.",
        `${payload.serviceName || "Service"} with ${payload.barberName || "your barber"}`,
        `When: ${summary || "TBC"}`,
        `Reference: ${payload.bookingId || "-"}`,
        "",
        "Helpful before your visit:",
        "- Arrive 5 minutes early so we can get you settled.",
        "- If you need to change your time, use your portal booking list or contact us.",
        "- Running late? Please call us so we can help."
      ].join("\n") + textSignoff,
      html: [
        `<p>Hi ${escapeHtml(payload.customerName || "there")},</p>`,
        "<p>Great news, your appointment is all set.</p>",
        `<p><strong>${escapeHtml(payload.serviceName || "Service")}</strong> with ${escapeHtml(payload.barberName || "your barber")}</p>`,
        `<p><strong>When:</strong> ${escapeHtml(summary || "TBC")}</p>`,
        `<p><strong>Reference:</strong> ${escapeHtml(payload.bookingId || "-")}</p>`,
        "<p><strong>Helpful before your visit:</strong></p>",
        "<ul><li>Arrive 5 minutes early so we can get you settled.</li><li>If you need to change your time, use your portal booking list or contact us.</li><li>Running late? Please call us so we can help.</li></ul>",
        htmlSignoff
      ].join("\n"),
    };
  }

  if (entry.template === "booking-cancelled") {
    const summary = `${payload.date || ""} ${payload.time || ""}`.trim();
    return {
      text: [
        `Hi ${payload.customerName || "there"},`,
        "",
        "Your booking has been cancelled.",
        `Cancelled time: ${summary || "TBC"}`,
        `Reference: ${payload.bookingId || "-"}`,
        "",
        "If this was a mistake, just reply to this email and we'll help you get rebooked quickly."
      ].join("\n") + textSignoff,
      html: [
        `<p>Hi ${escapeHtml(payload.customerName || "there")},</p>`,
        "<p>Your booking has been cancelled.</p>",
        `<p><strong>Cancelled time:</strong> ${escapeHtml(summary || "TBC")}</p>`,
        `<p><strong>Reference:</strong> ${escapeHtml(payload.bookingId || "-")}</p>`,
        "<p>If this was a mistake, just reply to this email and we'll help you get rebooked quickly.</p>",
        htmlSignoff
      ].join("\n"),
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

function createRecurringScheduleKey(barberId, weekday) {
  return `${barberId}::${weekday}`;
}

function getEffectiveSchedule(store, date, barberId) {
  const weekday = new Date(`${date}T00:00:00`).getDay();
  const recurringKey = createRecurringScheduleKey(barberId, weekday);
  const recurring = store.weeklySchedules[recurringKey] || null;
  const holiday = store.timeOff.find((entry) => entry.barberId === barberId && isDateInRange(date, entry.startDate, entry.endDate));

  if (holiday) {
    return {
      startHour: 0,
      closeHour: 0,
      blockedSlots: [],
      lunchStart: null,
      lunchEnd: null,
      isDayOff: true,
      label: holiday.label,
      source: "time-off"
    };
  }

  const base = {
    startHour: recurring ? Number(recurring.startHour) : store.config.openHour,
    closeHour: recurring ? Number(recurring.closeHour) : store.config.closeHour,
    blockedSlots: recurring
      ? buildLunchBlockedSlots(recurring.lunchStart, recurring.lunchEnd, Number(store.config.slotMinutes) || 30)
      : [],
    lunchStart: recurring && recurring.lunchStart ? recurring.lunchStart : null,
    lunchEnd: recurring && recurring.lunchEnd ? recurring.lunchEnd : null,
    isDayOff: false,
    label: "",
    source: recurring ? "weekly" : "default"
  };

  const key = createScheduleKey(date, barberId);
  if (!store.scheduleOverrides[key]) {
    return base;
  }

  const override = store.scheduleOverrides[key];
  return {
    ...base,
    startHour: Number(override.startHour),
    closeHour: Number(override.closeHour),
    blockedSlots: sanitizeBlockedSlots([...(base.blockedSlots || []), ...(override.blockedSlots || [])]),
    source: "override"
  };
}

function getRecurringScheduleSummary(store, barberId) {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const key = createRecurringScheduleKey(barberId, weekday);
    const value = store.weeklySchedules[key] || null;

    return {
      weekday,
      weekdayLabel: getWeekdayLabel(weekday),
      enabled: Boolean(value),
      startHour: value ? Number(value.startHour) : null,
      closeHour: value ? Number(value.closeHour) : null,
      lunchStart: value && value.lunchStart ? value.lunchStart : "",
      lunchEnd: value && value.lunchEnd ? value.lunchEnd : ""
    };
  });
}

function getTimeOffForBarber(store, barberId) {
  return store.timeOff
    .filter((entry) => entry.barberId === barberId)
    .sort((a, b) => Date.parse(`${a.startDate}T00:00:00`) - Date.parse(`${b.startDate}T00:00:00`));
}

function saveRecurringSchedule({ store, barberId, weekdays, startHour, closeHour, lunchStart, lunchEnd }) {
  const normalizedWeekdays = [...new Set(weekdays.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))];

  if (!normalizedWeekdays.length) {
    return { status: 400, error: "Select at least one weekday" };
  }

  if (!Number.isInteger(startHour) || !Number.isInteger(closeHour) || startHour < 0 || closeHour > 24 || startHour >= closeHour) {
    return { status: 400, error: "startHour and closeHour must be integers where 0 <= startHour < closeHour <= 24" };
  }

  if ((lunchStart && !isValidTimeInput(lunchStart)) || (lunchEnd && !isValidTimeInput(lunchEnd))) {
    return { status: 400, error: "Lunch times must be in HH:MM format" };
  }

  if ((lunchStart && !lunchEnd) || (!lunchStart && lunchEnd)) {
    return { status: 400, error: "Set both lunch start and lunch end, or leave both empty" };
  }

  if (lunchStart && lunchEnd) {
    const lunchStartMinutes = timeToMinutes(lunchStart);
    const lunchEndMinutes = timeToMinutes(lunchEnd);
    if (lunchStartMinutes >= lunchEndMinutes) {
      return { status: 400, error: "Lunch end must be after lunch start" };
    }

    if (lunchStartMinutes < startHour * 60 || lunchEndMinutes > closeHour * 60) {
      return { status: 400, error: "Lunch break must sit inside the working shift" };
    }
  }

  normalizedWeekdays.forEach((weekday) => {
    const key = createRecurringScheduleKey(barberId, weekday);
    store.weeklySchedules[key] = {
      startHour,
      closeHour,
      lunchStart: lunchStart || "",
      lunchEnd: lunchEnd || ""
    };
  });

  return { status: 200 };
}

function saveDateOverride({ store, barberId, date, startHour, closeHour, blockedSlots }) {
  if (!date || Number.isNaN(startHour) || Number.isNaN(closeHour)) {
    return { status: 400, error: "date, startHour, and closeHour are required" };
  }

  if (!isValidDateInput(date)) {
    return { status: 400, error: "date must be in YYYY-MM-DD format" };
  }

  if (!Number.isInteger(startHour) || !Number.isInteger(closeHour) || startHour < 0 || closeHour > 24 || startHour >= closeHour) {
    return { status: 400, error: "startHour and closeHour must be integers where 0 <= startHour < closeHour <= 24" };
  }

  const key = createScheduleKey(date, barberId);
  store.scheduleOverrides[key] = {
    startHour,
    closeHour,
    blockedSlots: sanitizeBlockedSlots(blockedSlots)
  };

  return { store, schedule: store.scheduleOverrides[key] };
}

function addTimeOffRange({ store, barberId, startDate, endDate, label }) {
  if (!startDate || !endDate) {
    return { status: 400, error: "startDate and endDate are required" };
  }

  if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
    return { status: 400, error: "Dates must be in YYYY-MM-DD format" };
  }

  if (Date.parse(`${startDate}T00:00:00`) > Date.parse(`${endDate}T00:00:00`)) {
    return { status: 400, error: "endDate must be on or after startDate" };
  }

  const item = {
    id: createTimeOffId(),
    barberId,
    startDate,
    endDate,
    label: label || "Holiday"
  };

  store.timeOff.push(item);
  return { item };
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

function buildLunchBlockedSlots(lunchStart, lunchEnd, slotMinutes) {
  if (!lunchStart || !lunchEnd || !isValidTimeInput(lunchStart) || !isValidTimeInput(lunchEnd)) {
    return [];
  }

  const start = timeToMinutes(lunchStart);
  const end = timeToMinutes(lunchEnd);
  if (start >= end) {
    return [];
  }

  const slots = [];
  for (let minute = start; minute < end; minute += slotMinutes) {
    slots.push(minutesToTime(minute));
  }

  return slots;
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

function isDateInRange(date, startDate, endDate) {
  const target = Date.parse(`${date}T00:00:00`);
  const start = Date.parse(`${startDate}T00:00:00`);
  const end = Date.parse(`${endDate}T00:00:00`);
  return target >= start && target <= end;
}

function getWeekdayLabel(weekday) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday] || "";
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

function createStaffSession(staffAccountId) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + STAFF_SESSION_TTL_MS;
  staffSessions.set(token, { staffAccountId, expiresAt });
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

function getStaffToken(req) {
  const customHeader = req.header("x-staff-token");
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

function requireStaffAuth(req, res, next) {
  const token = getStaffToken(req);
  if (!token) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }

  const session = staffSessions.get(token);
  if (!session) {
    res.status(401).json({ error: "Session invalid or expired" });
    return;
  }

  if (session.expiresAt <= Date.now()) {
    staffSessions.delete(token);
    res.status(401).json({ error: "Session expired" });
    return;
  }

  const store = readStore();
  const staffAccount = store.staffAccounts.find((entry) => entry.id === session.staffAccountId);
  if (!staffAccount) {
    staffSessions.delete(token);
    res.status(401).json({ error: "Staff account not found" });
    return;
  }

  const barber = store.barbers.find((entry) => entry.id === staffAccount.barberId);
  if (!barber) {
    staffSessions.delete(token);
    res.status(401).json({ error: "Assigned barber not found" });
    return;
  }

  req.staffToken = token;
  req.staffAccount = staffAccount;
  req.staffBarber = barber;
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

function sanitizeStaffAccount(account, barber) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    barberId: account.barberId,
    barberName: barber ? barber.name : account.name,
    createdAt: account.createdAt,
    isSeedAccount: Boolean(account.isSeedAccount)
  };
}

function createTimeOffId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `OFF-${stamp}-${random}`;
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

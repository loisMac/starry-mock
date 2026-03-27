document.addEventListener("DOMContentLoaded", () => {
  initScrollProgress();
  initServiceCardReveal();
  initStudioOpenBadge();
  initMobileMenu();
  initHeroReveal();

  if (document.getElementById("booking-form")) {
    initBookingPage();
  }

  if (document.getElementById("admin-app")) {
    initAdminPage();
  }

  if (document.getElementById("customer-app")) {
    initCustomerPage();
  }
});

const ADMIN_TOKEN_KEY = "northline.admin.token";
const STAFF_TOKEN_KEY = "northline.staff.token";
const CUSTOMER_TOKEN_KEY = "northline.customer.token";

function resolveApiUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const path = url.startsWith("/") ? url : `/${url}`;
  const { protocol, hostname, port } = window.location;
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";

  if (path.startsWith("/api/")) {
    const isApiOrigin = isLocalHost && (port === "3000" || (!port && protocol !== "file:"));
    if (!isApiOrigin) {
      return `http://localhost:3000${path}`;
    }
  }

  if (protocol === "file:" || (isLocalHost && port && port !== "3000")) {
    return `http://localhost:3000${path}`;
  }

  return path;
}

function initHeroReveal() {
  const hero = document.querySelector(".luxury-hero");
  const title = hero ? hero.querySelector(".hero-title") : null;

  if (!hero || !title) {
    return;
  }

  if (!title.querySelector(".hero-word")) {
    const words = title.textContent.trim().split(/\s+/);
    title.textContent = "";

    words.forEach((word, index) => {
      const span = document.createElement("span");
      span.className = "hero-word";
      span.style.animationDelay = `${index * 0.08}s`;
      span.textContent = word;
      title.appendChild(span);

      if (index < words.length - 1) {
        title.appendChild(document.createTextNode(" "));
      }
    });
  }

  requestAnimationFrame(() => {
    hero.classList.add("hero-animate");
  });
}

function initMobileMenu() {
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".main-nav");

  if (!toggle || !nav) {
    return;
  }

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    nav.classList.toggle("open");
  });
}

function initScrollProgress() {
  if (document.getElementById("scroll-progress")) {
    return;
  }

  const progress = document.createElement("div");
  progress.id = "scroll-progress";
  progress.setAttribute("aria-hidden", "true");
  document.body.appendChild(progress);

  const updateProgress = () => {
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - doc.clientHeight;
    const ratio = scrollable > 0 ? window.scrollY / scrollable : 0;
    const clamped = Math.max(0, Math.min(1, ratio));
    progress.style.transform = `scaleX(${clamped})`;
    progress.style.opacity = scrollable > 0 ? "1" : "0";
  };

  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);
  updateProgress();
}

function initServiceCardReveal() {
  const cards = [...document.querySelectorAll(".service-grid .card")];
  if (!cards.length) {
    return;
  }

  cards.forEach((card) => card.classList.add("service-card--reveal"));

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cards.forEach((card) => card.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      entry.target.classList.add("is-visible");
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.18, rootMargin: "0px 0px -10% 0px" });

  cards.forEach((card, index) => {
    card.style.transitionDelay = `${index * 70}ms`;
    observer.observe(card);
  });
}

function initStudioOpenBadge() {
  const badge = document.getElementById("studio-open-status");
  if (!badge) {
    return;
  }

  const now = new Date();
  const day = now.getDay();
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  // Mon-Fri 09:00-20:00, Sat 10:00-17:00, Sun closed
  let openMinutes = -1;
  let closeMinutes = -1;

  if (day >= 1 && day <= 5) {
    openMinutes = 9 * 60;
    closeMinutes = 20 * 60;
  } else if (day === 6) {
    openMinutes = 10 * 60;
    closeMinutes = 17 * 60;
  }

  const toTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

  if (openMinutes === -1) {
    badge.classList.add("is-closed");
    badge.textContent = "Closed today (Sunday)";
    return;
  }

  if (minutesNow >= openMinutes && minutesNow < closeMinutes) {
    badge.classList.add("is-open");
    badge.textContent = `Open now until ${toTime(closeMinutes)}`;
    return;
  }

  badge.classList.add("is-closed");
  if (minutesNow < openMinutes) {
    badge.textContent = `Closed now. Opens at ${toTime(openMinutes)}`;
  } else {
    badge.textContent = "Closed for today";
  }
}

async function initBookingPage() {
  const form = document.getElementById("booking-form");
  const serviceSelect = document.getElementById("service");
  const barberSelect = document.getElementById("barber");
  const dateInput = document.getElementById("appointment-date");
  const selectedSlotInput = document.getElementById("selected-slot");
  const slotGrid = document.getElementById("slot-grid");
  const slotMessage = document.getElementById("slot-message");
  const formMessage = document.getElementById("form-message");
  const bookingsList = document.getElementById("bookings-list");
  const accountStatus = document.getElementById("booking-account-status");

  if (
    !form ||
    !serviceSelect ||
    !barberSelect ||
    !dateInput ||
    !selectedSlotInput ||
    !slotGrid ||
    !slotMessage ||
    !formMessage ||
    !bookingsList ||
    !accountStatus
  ) {
    return;
  }

  let currentCustomer = null;

  try {
    const [services, barbers] = await Promise.all([apiGet("/api/services"), apiGet("/api/barbers")]);
    hydrateSelect(serviceSelect, services, (service) => `${service.name} (${service.duration} min)`);
    hydrateSelect(barberSelect, barbers, (barber) => barber.name);
    dateInput.min = formatDateInputValue(new Date());

    currentCustomer = await getCurrentCustomerSession();
    applyCustomerPrefill();

    serviceSelect.addEventListener("change", () => {
      renderAvailableSlots();
    });
    barberSelect.addEventListener("change", () => {
      renderAvailableSlots();
    });
    dateInput.addEventListener("change", () => {
      renderAvailableSlots();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      formMessage.className = "form-message";
      formMessage.textContent = "";

      if (!form.checkValidity()) {
        formMessage.classList.add("error");
        formMessage.textContent = "Could you fill in all the details before confirming?";
        form.reportValidity();
        return;
      }

      if (!selectedSlotInput.value) {
        formMessage.classList.add("error");
        formMessage.textContent = "Pick a time slot to carry on.";
        return;
      }

      const payload = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        phone: form.phone.value.trim(),
        serviceId: serviceSelect.value,
        barberId: barberSelect.value,
        date: dateInput.value,
        time: selectedSlotInput.value
      };

      try {
        const booking = await apiPostWithHeaders("/api/bookings", payload, getCustomerHeaders());
        formMessage.classList.add("success");
        formMessage.textContent = `You're all booked in. Ref: ${booking.id}`;

        selectedSlotInput.value = "";
        await renderAvailableSlots();
        await renderMyBookings();
      } catch (error) {
        formMessage.classList.add("error");
        formMessage.textContent = error.message || "Sorry, we couldn't complete that booking right now.";
      }
    });

    await renderAvailableSlots();
    await renderMyBookings();
  } catch (_error) {
    slotMessage.textContent = "Booking is unavailable right now. Start the Node server, then refresh.";
    formMessage.className = "form-message error";
    formMessage.textContent = "We couldn't connect to the booking service.";
  }

  function applyCustomerPrefill() {
    if (!currentCustomer) {
      accountStatus.innerHTML = 'Sign in to your <a href="account.html">portal</a> to view and manage appointments.';
      return;
    }

    form.name.value = currentCustomer.name || "";
    form.email.value = currentCustomer.email || "";
    form.phone.value = currentCustomer.phone || "";
    accountStatus.innerHTML = `Signed in as ${currentCustomer.name}. Manage all bookings in your <a href="account.html">client portal</a>.`;
  }

  async function renderAvailableSlots() {
    const selectedService = serviceSelect.value;
    const selectedBarber = barberSelect.value;
    const selectedDate = dateInput.value;

    selectedSlotInput.value = "";
    slotGrid.innerHTML = "";

    if (!selectedService || !selectedBarber || !selectedDate) {
      slotMessage.textContent = "Choose a service, team member, and date to load times.";
      return;
    }

    try {
      const availability = await apiGet(
        `/api/availability?date=${encodeURIComponent(selectedDate)}&barberId=${encodeURIComponent(selectedBarber)}&serviceId=${encodeURIComponent(selectedService)}`
      );

      slotMessage.textContent = availability.availableCount
        ? `Showing ${availability.availableCount} available slot${availability.availableCount > 1 ? "s" : ""}.`
        : "No times left for this date with that team member.";

      availability.slots.forEach((slot) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "slot-btn";
        button.textContent = slot.time;
        button.disabled = !slot.available;

        if (slot.available) {
          button.addEventListener("click", () => {
            document.querySelectorAll(".slot-btn").forEach((item) => item.classList.remove("is-selected"));
            button.classList.add("is-selected");
            selectedSlotInput.value = slot.time;
          });
        }

        slotGrid.appendChild(button);
      });
    } catch (_error) {
      slotMessage.textContent = "We couldn't load available times just now.";
    }
  }

  async function renderMyBookings() {
    bookingsList.innerHTML = "";

    if (!currentCustomer) {
      bookingsList.innerHTML = '<li class="booking-item">Create or sign in to a portal account to view appointments here.</li>';
      return;
    }

    try {
      const bookings = await customerApiGet("/api/customer/bookings");
      if (!bookings.length) {
        bookingsList.innerHTML = '<li class="booking-item">No upcoming bookings in your account.</li>';
        return;
      }

      bookings.forEach((booking) => {
        const item = document.createElement("li");
        item.className = "booking-item";
        item.innerHTML = `
          <div class="booking-row"><strong>${booking.date}</strong><span>${booking.time}</span></div>
          <div>${booking.serviceName} • ${booking.barberName}</div>
          <div class="booking-row"><span>${booking.name}</span><span>${booking.id}</span></div>
        `;

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "cancel-btn";
        cancelButton.textContent = "Cancel booking";
        cancelButton.addEventListener("click", async () => {
          try {
            await customerApiDelete(`/api/customer/bookings/${encodeURIComponent(booking.id)}`);
            await renderMyBookings();
            await renderAvailableSlots();
          } catch (error) {
            formMessage.className = "form-message error";
            formMessage.textContent = error.message || "Sorry, we couldn't cancel that booking.";
          }
        });

        item.appendChild(cancelButton);
        bookingsList.appendChild(item);
      });
    } catch (error) {
      if (isCustomerAuthError(error)) {
        clearCustomerToken();
      }
      bookingsList.innerHTML = '<li class="booking-item">Sign in to your portal to manage bookings.</li>';
    }
  }
}

async function initCustomerPage() {
  const authWrap = document.getElementById("customer-auth-wrap");
  const dashboard = document.getElementById("customer-dashboard");
  const loginForm = document.getElementById("customer-login-form");
  const registerForm = document.getElementById("customer-register-form");
  const resetRequestForm = document.getElementById("customer-reset-request-form");
  const resendVerificationForm = document.getElementById("customer-resend-verification-form");
  const resetCompleteForm = document.getElementById("customer-reset-complete-form");
  const loginMessage = document.getElementById("customer-login-message");
  const registerMessage = document.getElementById("customer-register-message");
  const resetRequestMessage = document.getElementById("customer-reset-request-message");
  const resendMessage = document.getElementById("customer-resend-message");
  const resetCompleteMessage = document.getElementById("customer-reset-complete-message");
  const greeting = document.getElementById("customer-greeting");
  const bookingsMeta = document.getElementById("customer-bookings-meta");
  const bookingsList = document.getElementById("customer-bookings-list");
  const logoutButton = document.getElementById("customer-logout-btn");

  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  if (window.location.protocol === "file:" || (isLocalHost && window.location.port && window.location.port !== "3000")) {
    loginMessage.className = "form-message";
    loginMessage.textContent = "You're on a preview host. We'll route requests to localhost:3000.";
  }

  if (
    !authWrap ||
    !dashboard ||
    !loginForm ||
    !registerForm ||
    !resetRequestForm ||
    !resendVerificationForm ||
    !resetCompleteForm ||
    !loginMessage ||
    !registerMessage ||
    !resetRequestMessage ||
    !resendMessage ||
    !resetCompleteMessage ||
    !greeting ||
    !bookingsMeta ||
    !bookingsList ||
    !logoutButton
  ) {
    return;
  }

  let currentCustomer = null;
  const url = new URL(window.location.href);
  const verifyToken = url.searchParams.get("verify");
  const resetToken = url.searchParams.get("reset");

  if (verifyToken) {
    try {
      const response = await apiPost("/api/customer/verify-email", { token: verifyToken });
      loginMessage.className = "form-message success";
      loginMessage.textContent = response.message || "Nice one. Email verified, you can sign in now.";
    } catch (error) {
      loginMessage.className = "form-message error";
      loginMessage.textContent = error.message || "That verification link has expired or isn't valid anymore.";
    } finally {
      url.searchParams.delete("verify");
      window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
    }
  }

  if (resetToken) {
    resetCompleteForm.classList.remove("hidden");
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginMessage.className = "form-message";
    loginMessage.textContent = "";

    if (!loginForm.checkValidity()) {
      loginMessage.className = "form-message error";
      loginMessage.textContent = "Pop in both your email and password.";
      loginForm.reportValidity();
      return;
    }

    try {
      const payload = {
        email: loginForm.email.value.trim(),
        password: loginForm.password.value
      };
      const response = await apiPost("/api/customer/login", payload);
      setCustomerToken(response.token);
      await enterCustomerDashboard();
      loginForm.reset();
    } catch (error) {
      loginMessage.className = "form-message error";
      loginMessage.textContent = error.message || "We couldn't sign you in just now.";
    }
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    registerMessage.className = "form-message";
    registerMessage.textContent = "";

    if (!registerForm.checkValidity()) {
      registerMessage.className = "form-message error";
      registerMessage.textContent = "Could you complete all the sign-up fields?";
      registerForm.reportValidity();
      return;
    }

    try {
      const payload = {
        name: registerForm.name.value.trim(),
        email: registerForm.email.value.trim(),
        phone: registerForm.phone.value.trim(),
        password: registerForm.password.value
      };
      const response = await apiPost("/api/customer/register", payload);
      registerMessage.className = "form-message success";
      registerMessage.textContent =
        response.message || "You're all set. Check your inbox for your verification link.";
      registerForm.reset();
    } catch (error) {
      registerMessage.className = "form-message error";
      registerMessage.textContent = error.message || "Sorry, we couldn't create your account yet.";
    }
  });

  resetRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    resetRequestMessage.className = "form-message";
    resetRequestMessage.textContent = "";

    if (!resetRequestForm.checkValidity()) {
      resetRequestMessage.className = "form-message error";
      resetRequestMessage.textContent = "Enter the email linked to your account.";
      resetRequestForm.reportValidity();
      return;
    }

    try {
      const payload = {
        email: resetRequestForm.email.value.trim()
      };
      const response = await apiPost("/api/customer/request-password-reset", payload);
      resetRequestMessage.className = "form-message success";
      resetRequestMessage.textContent =
        response.message || "If that account exists, we've sent a reset link.";
      resetRequestForm.reset();
    } catch (error) {
      resetRequestMessage.className = "form-message error";
      resetRequestMessage.textContent = error.message || "We couldn't request a password reset right now.";
    }
  });

  resendVerificationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    resendMessage.className = "form-message";
    resendMessage.textContent = "";

    if (!resendVerificationForm.checkValidity()) {
      resendMessage.className = "form-message error";
      resendMessage.textContent = "Enter the email linked to your account.";
      resendVerificationForm.reportValidity();
      return;
    }

    try {
      const payload = {
        email: resendVerificationForm.email.value.trim()
      };
      const response = await apiPost("/api/customer/resend-verification", payload);
      resendMessage.className = "form-message success";
      resendMessage.textContent = response.message || "Verification email sent. Please check your inbox.";
      resendVerificationForm.reset();
    } catch (error) {
      resendMessage.className = "form-message error";
      resendMessage.textContent = error.message || "We couldn't resend that verification email.";
    }
  });

  resetCompleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    resetCompleteMessage.className = "form-message";
    resetCompleteMessage.textContent = "";

    if (!resetToken) {
      resetCompleteMessage.className = "form-message error";
      resetCompleteMessage.textContent = "Looks like that reset link is missing a token.";
      return;
    }

    if (!resetCompleteForm.checkValidity()) {
      resetCompleteMessage.className = "form-message error";
      resetCompleteMessage.textContent = "Your new password needs to be at least 8 characters.";
      resetCompleteForm.reportValidity();
      return;
    }

    try {
      const payload = {
        token: resetToken,
        password: resetCompleteForm.newPassword.value
      };
      const response = await apiPost("/api/customer/reset-password", payload);
      resetCompleteMessage.className = "form-message success";
      resetCompleteMessage.textContent = response.message || "Nice one, your password has been updated.";
      resetCompleteForm.reset();
    } catch (error) {
      resetCompleteMessage.className = "form-message error";
      resetCompleteMessage.textContent = error.message || "We couldn't reset your password just now.";
    }
  });

  logoutButton.addEventListener("click", async () => {
    try {
      await customerApiPost("/api/customer/logout", {});
    } catch (_error) {
      // Safe to ignore if already expired.
    }

    clearCustomerToken();
    currentCustomer = null;
    exitCustomerDashboard();
  });

  if (getCustomerToken()) {
    try {
      await customerApiGet("/api/customer/session");
      await enterCustomerDashboard();
    } catch (_error) {
      clearCustomerToken();
      exitCustomerDashboard();
    }
  } else {
    exitCustomerDashboard();
  }

  async function enterCustomerDashboard() {
    currentCustomer = await customerApiGet("/api/customer/me");
    greeting.textContent = `Welcome, ${currentCustomer.name}`;
    authWrap.classList.add("hidden");
    dashboard.classList.remove("hidden");
    await renderCustomerBookings();
  }

  function exitCustomerDashboard() {
    dashboard.classList.add("hidden");
    authWrap.classList.remove("hidden");
    bookingsList.innerHTML = "";
    bookingsMeta.textContent = "Sign in to see your appointments.";
  }

  async function renderCustomerBookings() {
    bookingsList.innerHTML = "";
    const bookings = await customerApiGet("/api/customer/bookings");
    bookingsMeta.textContent = `${bookings.length} upcoming booking${bookings.length === 1 ? "" : "s"}.`;

    if (!bookings.length) {
      bookingsList.innerHTML = '<li class="booking-item">No appointments yet. Book your next visit now.</li>';
      return;
    }

    bookings.forEach((booking) => {
      const item = document.createElement("li");
      item.className = "booking-item";
      item.innerHTML = `
        <div class="booking-row"><strong>${booking.date}</strong><span>${booking.time}</span></div>
        <div>${booking.serviceName} • ${booking.barberName}</div>
        <div class="booking-row"><span>${booking.phone}</span><span>${booking.id}</span></div>
      `;

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "cancel-btn";
      cancelButton.textContent = "Cancel booking";
      cancelButton.addEventListener("click", async () => {
        try {
          await customerApiDelete(`/api/customer/bookings/${encodeURIComponent(booking.id)}`);
          await renderCustomerBookings();
        } catch (error) {
          bookingsMeta.textContent = error.message || "Sorry, we couldn't cancel that booking.";
        }
      });

      item.appendChild(cancelButton);
      bookingsList.appendChild(item);
    });
  }
}

async function initAdminPage() {
  const authWrap = document.getElementById("admin-auth-wrap");
  const dashboard = document.getElementById("admin-dashboard");
  const adminLoginForm = document.getElementById("admin-login-form");
  const adminPasswordInput = document.getElementById("admin-password");
  const adminAuthMessage = document.getElementById("admin-auth-message");
  const staffLoginForm = document.getElementById("staff-login-form");
  const staffEmailInput = document.getElementById("staff-email");
  const staffPasswordInput = document.getElementById("staff-password");
  const staffAuthMessage = document.getElementById("staff-auth-message");
  const logoutButton = document.getElementById("admin-logout-btn");
  const schedulerTitle = document.getElementById("scheduler-title");
  const schedulerContext = document.getElementById("scheduler-context");
  const barberSelect = document.getElementById("admin-barber");
  const dateInput = document.getElementById("admin-date");
  const startHourInput = document.getElementById("start-hour");
  const closeHourInput = document.getElementById("close-hour");
  const slotGrid = document.getElementById("admin-slot-grid");
  const scheduleForm = document.getElementById("schedule-form");
  const scheduleMessage = document.getElementById("schedule-message");
  const clearOverrideButton = document.getElementById("clear-override-btn");
  const weeklyForm = document.getElementById("weekly-form");
  const weeklyStartHourInput = document.getElementById("weekly-start-hour");
  const weeklyCloseHourInput = document.getElementById("weekly-close-hour");
  const lunchStartInput = document.getElementById("lunch-start");
  const lunchEndInput = document.getElementById("lunch-end");
  const weeklyMessage = document.getElementById("weekly-message");
  const weeklySummary = document.getElementById("weekly-summary");
  const timeoffForm = document.getElementById("timeoff-form");
  const timeoffStartDateInput = document.getElementById("timeoff-start-date");
  const timeoffEndDateInput = document.getElementById("timeoff-end-date");
  const timeoffLabelInput = document.getElementById("timeoff-label");
  const timeoffMessage = document.getElementById("timeoff-message");
  const timeoffList = document.getElementById("timeoff-list");
  const bookingsPanel = document.getElementById("admin-bookings-panel");
  const bookingsList = document.getElementById("admin-bookings-list");
  const overviewMeta = document.getElementById("overview-meta");
  const calGrid = document.getElementById("cal-grid");
  const calMonthLabel = document.getElementById("cal-month-label");
  const calPrevBtn = document.getElementById("cal-prev-btn");
  const calNextBtn = document.getElementById("cal-next-btn");
  const staffPasswordSection = document.getElementById("staff-password-section");
  const staffPasswordForm = document.getElementById("staff-password-form");
  const passwordChangeMessage = document.getElementById("password-change-message");

  if (
    !authWrap ||
    !dashboard ||
    !adminLoginForm ||
    !adminPasswordInput ||
    !adminAuthMessage ||
    !staffLoginForm ||
    !staffEmailInput ||
    !staffPasswordInput ||
    !staffAuthMessage ||
    !logoutButton ||
    !schedulerTitle ||
    !schedulerContext ||
    !barberSelect ||
    !dateInput ||
    !startHourInput ||
    !closeHourInput ||
    !slotGrid ||
    !scheduleForm ||
    !scheduleMessage ||
    !clearOverrideButton ||
    !weeklyForm ||
    !weeklyStartHourInput ||
    !weeklyCloseHourInput ||
    !lunchStartInput ||
    !lunchEndInput ||
    !weeklyMessage ||
    !weeklySummary ||
    !timeoffForm ||
    !timeoffStartDateInput ||
    !timeoffEndDateInput ||
    !timeoffLabelInput ||
    !timeoffMessage ||
    !timeoffList ||
    !bookingsPanel ||
    !bookingsList ||
    !overviewMeta ||
    !calGrid ||
    !calMonthLabel ||
    !calPrevBtn ||
    !calNextBtn ||
    !staffPasswordSection ||
    !staffPasswordForm ||
    !passwordChangeMessage
  ) {
    return;
  }

  let slotSelection = new Set();
  let currentMode = null;
  let currentStaff = null;
  let barbers = [];
  const today = new Date();
  let calYear = today.getFullYear();
  let calMonth = today.getMonth() + 1;

  adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    adminAuthMessage.className = "form-message";
    adminAuthMessage.textContent = "";

    if (!adminLoginForm.checkValidity()) {
      adminAuthMessage.className = "form-message error";
      adminAuthMessage.textContent = "Please enter the admin password.";
      adminLoginForm.reportValidity();
      return;
    }

    try {
      const response = await apiPost("/api/admin/login", { password: adminPasswordInput.value });
      setAdminToken(response.token);
      clearStaffToken();
      adminPasswordInput.value = "";
      await enterDashboard("admin");
    } catch (error) {
      adminAuthMessage.className = "form-message error";
      adminAuthMessage.textContent = error.message || "We couldn't sign you in as admin.";
    }
  });

  staffLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    staffAuthMessage.className = "form-message";
    staffAuthMessage.textContent = "";

    if (!staffLoginForm.checkValidity()) {
      staffAuthMessage.className = "form-message error";
      staffAuthMessage.textContent = "Please enter your staff email and password.";
      staffLoginForm.reportValidity();
      return;
    }

    try {
      const response = await apiPost("/api/staff/login", {
        email: staffEmailInput.value.trim(),
        password: staffPasswordInput.value
      });
      setStaffToken(response.token);
      clearAdminToken();
      staffPasswordInput.value = "";
      await enterDashboard("staff");
    } catch (error) {
      staffAuthMessage.className = "form-message error";
      staffAuthMessage.textContent = error.message || "We couldn't sign you in as staff.";
    }
  });

  logoutButton.addEventListener("click", async () => {
    try {
      if (currentMode === "admin") {
        await adminApiPost("/api/admin/logout", {});
      }
      if (currentMode === "staff") {
        await staffApiPost("/api/staff/logout", {});
      }
    } catch (_error) {
      // Safe to ignore if already expired.
    }

    clearAdminToken();
    clearStaffToken();
    currentMode = null;
    currentStaff = null;
    exitDashboard();
  });

  if (getAdminToken()) {
    try {
      await adminApiGet("/api/admin/session");
      await enterDashboard("admin");
      return;
    } catch (_error) {
      clearAdminToken();
    }
  }

  if (getStaffToken()) {
    try {
      await staffApiGet("/api/staff/session");
      await enterDashboard("staff");
      return;
    } catch (_error) {
      clearStaffToken();
    }
  }

  exitDashboard();

  barberSelect.addEventListener("change", async () => {
    await refreshSchedulingViews();
  });

  dateInput.addEventListener("change", async () => {
    await loadScheduleForSelection();
    await loadOverviewIfAllowed();
  });

  startHourInput.addEventListener("change", renderAdminSlotToggles);
  closeHourInput.addEventListener("change", renderAdminSlotToggles);

  clearOverrideButton.addEventListener("click", async () => {
    if (!getSelectedBarberId() || !dateInput.value) {
      return;
    }

    try {
      await deleteScheduleOverride(dateInput.value, getSelectedBarberId());
      scheduleMessage.className = "form-message success";
      scheduleMessage.textContent = "Done. This day now follows the regular weekly schedule.";
      await loadScheduleForSelection();
      await loadOverviewIfAllowed();
    } catch (error) {
      if (isSchedulerAuthError(error)) {
        handleSchedulerAuthFailure();
        return;
      }
      scheduleMessage.className = "form-message error";
      scheduleMessage.textContent = error.message || "We couldn't clear that override right now.";
    }
  });

  scheduleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    scheduleMessage.className = "form-message";
    scheduleMessage.textContent = "";

    if (!scheduleForm.checkValidity()) {
      scheduleMessage.className = "form-message error";
      scheduleMessage.textContent = "Please complete all schedule fields first.";
      scheduleForm.reportValidity();
      return;
    }

    try {
      await saveScheduleOverride({
        date: dateInput.value,
        barberId: getSelectedBarberId(),
        startHour: Number(startHourInput.value),
        closeHour: Number(closeHourInput.value),
        blockedSlots: [...slotSelection]
      });
      scheduleMessage.className = "form-message success";
      scheduleMessage.textContent = "Daily override saved.";
      await loadScheduleForSelection();
      await loadOverviewIfAllowed();
    } catch (error) {
      if (isSchedulerAuthError(error)) {
        handleSchedulerAuthFailure();
        return;
      }
      scheduleMessage.className = "form-message error";
      scheduleMessage.textContent = error.message || "We couldn't save that schedule override.";
    }
  });

  weeklyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    weeklyMessage.className = "form-message";
    weeklyMessage.textContent = "";

    const weekdays = [...weeklyForm.querySelectorAll('input[name="weekday"]:checked')].map((input) => Number(input.value));
    if (!weekdays.length) {
      weeklyMessage.className = "form-message error";
      weeklyMessage.textContent = "Please choose at least one weekday.";
      return;
    }

    try {
      await saveRecurringTemplate({
        barberId: getSelectedBarberId(),
        weekdays,
        startHour: Number(weeklyStartHourInput.value),
        closeHour: Number(weeklyCloseHourInput.value),
        lunchStart: lunchStartInput.value,
        lunchEnd: lunchEndInput.value
      });
      weeklyMessage.className = "form-message success";
      weeklyMessage.textContent = "Weekly recurring shift saved.";
      await refreshSchedulingViews();
    } catch (error) {
      if (isSchedulerAuthError(error)) {
        handleSchedulerAuthFailure();
        return;
      }
      weeklyMessage.className = "form-message error";
      weeklyMessage.textContent = error.message || "We couldn't save that recurring shift.";
    }
  });

  timeoffForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    timeoffMessage.className = "form-message";
    timeoffMessage.textContent = "";

    if (!timeoffForm.checkValidity()) {
      timeoffMessage.className = "form-message error";
      timeoffMessage.textContent = "Please choose both a start date and an end date.";
      timeoffForm.reportValidity();
      return;
    }

    try {
      await addHolidayBlock({
        barberId: getSelectedBarberId(),
        startDate: timeoffStartDateInput.value,
        endDate: timeoffEndDateInput.value,
        label: timeoffLabelInput.value.trim() || "Holiday"
      });
      timeoffMessage.className = "form-message success";
      timeoffMessage.textContent = "Time-off block saved.";
      timeoffForm.reset();
      timeoffLabelInput.value = "Holiday";
      await loadTimeOff();
      await loadScheduleForSelection();
      await loadOverviewIfAllowed();
    } catch (error) {
      if (isSchedulerAuthError(error)) {
        handleSchedulerAuthFailure();
        return;
      }
      timeoffMessage.className = "form-message error";
      timeoffMessage.textContent = error.message || "We couldn't save that time-off block.";
    }
  });

  async function enterDashboard(mode) {
    currentMode = mode;
    currentStaff = null;
    authWrap.classList.add("hidden");
    dashboard.classList.remove("hidden");
    adminAuthMessage.className = "form-message";
    adminAuthMessage.textContent = "";
    staffAuthMessage.className = "form-message";
    staffAuthMessage.textContent = "";

    barbers = await apiGet("/api/barbers");
    hydrateSelect(barberSelect, barbers, (barber) => barber.name);

    const today = formatDateInputValue(new Date());
    dateInput.min = today;
    timeoffStartDateInput.min = today;
    timeoffEndDateInput.min = today;
    if (!dateInput.value) {
      dateInput.value = today;
    }

    if (mode === "admin") {
      barberSelect.disabled = false;
      if (barberSelect.options.length > 1) {
        barberSelect.selectedIndex = 1;
      }
      bookingsPanel.classList.remove("hidden");
      schedulerTitle.textContent = "Studio schedule manager";
      schedulerContext.textContent = "Admins can edit one-off overrides, weekly recurring shifts, lunches, holidays, and booking operations for any barber.";
    } else {
      currentStaff = await staffApiGet("/api/staff/me");
      barberSelect.innerHTML = "";
      const option = document.createElement("option");
      option.value = currentStaff.barberId;
      option.textContent = currentStaff.barberName;
      barberSelect.appendChild(option);
      barberSelect.value = currentStaff.barberId;
      barberSelect.disabled = true;
      bookingsPanel.classList.add("hidden");
      staffPasswordSection.classList.remove("hidden");
      schedulerTitle.textContent = `${currentStaff.barberName} schedule`;
      schedulerContext.textContent = "Staff mode lets you edit your own recurring weekdays, lunch break, holiday blocks, and one-day changes.";
    }

    weeklyStartHourInput.value = "9";
    weeklyCloseHourInput.value = "17";
    const nowDate = new Date();
    calYear = nowDate.getFullYear();
    calMonth = nowDate.getMonth() + 1;
    await refreshSchedulingViews();
  }

  function exitDashboard() {
    dashboard.classList.add("hidden");
    authWrap.classList.remove("hidden");
    bookingsPanel.classList.remove("hidden");
    staffPasswordSection.classList.add("hidden");
    barberSelect.disabled = false;
    scheduleMessage.textContent = "";
    weeklyMessage.textContent = "";
    timeoffMessage.textContent = "";
    bookingsList.innerHTML = "";
    weeklySummary.innerHTML = "";
    timeoffList.innerHTML = "";
    calGrid.innerHTML = "";
    calMonthLabel.textContent = "";
    overviewMeta.textContent = "Select barber and date to view appointments.";
  }

  function getSelectedBarberId() {
    if (currentMode === "staff" && currentStaff) {
      return currentStaff.barberId;
    }
    return barberSelect.value;
  }

  async function refreshSchedulingViews() {
    await loadScheduleForSelection();
    await loadRecurringSummary();
    await loadTimeOff();
    await loadCalendar();
    await loadOverviewIfAllowed();
  }

  async function loadScheduleForSelection() {
    if (!getSelectedBarberId() || !dateInput.value) {
      slotGrid.innerHTML = "";
      return;
    }

    const response = await getScheduleForDate(dateInput.value, getSelectedBarberId());
    startHourInput.value = response.schedule.startHour;
    closeHourInput.value = response.schedule.closeHour;
    slotSelection = new Set(response.schedule.blockedSlots || []);
    renderAdminSlotToggles();

    if (response.schedule.isDayOff) {
      scheduleMessage.className = "form-message";
      scheduleMessage.textContent = `This date is marked as ${response.schedule.label || "holiday"}.`;
    } else if (response.schedule.source === "weekly") {
      scheduleMessage.className = "form-message";
      scheduleMessage.textContent = "Using recurring weekly schedule for this date.";
    } else if (response.schedule.source === "override") {
      scheduleMessage.className = "form-message";
      scheduleMessage.textContent = "A one-day override is active for this date.";
    } else {
      scheduleMessage.className = "form-message";
      scheduleMessage.textContent = "Using default studio hours for this date.";
    }
  }

  function renderAdminSlotToggles() {
    const start = Number(startHourInput.value);
    const close = Number(closeHourInput.value);
    slotGrid.innerHTML = "";

    if (!Number.isInteger(start) || !Number.isInteger(close) || start >= close) {
      return;
    }

    for (let hour = start; hour < close; hour += 1) {
      ["00", "30"].forEach((minute) => {
        const time = `${String(hour).padStart(2, "0")}:${minute}`;
        const label = document.createElement("label");
        label.className = "slot-checkbox";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = time;
        input.checked = slotSelection.has(time);
        input.addEventListener("change", () => {
          if (input.checked) {
            slotSelection.add(time);
          } else {
            slotSelection.delete(time);
          }
        });

        const text = document.createElement("span");
        text.textContent = time;
        label.appendChild(input);
        label.appendChild(text);
        slotGrid.appendChild(label);
      });
    }
  }

  async function loadRecurringSummary() {
    weeklySummary.innerHTML = "";
    const response = await getRecurringTemplates(getSelectedBarberId());
    const enabledSchedules = response.schedules.filter((entry) => entry.enabled);

    if (!enabledSchedules.length) {
      weeklySummary.innerHTML = '<li class="booking-item">No recurring weekly shift saved yet. Staff currently fall back to studio default hours.</li>';
      return;
    }

    enabledSchedules.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "booking-item";
      item.innerHTML = `
        <div class="booking-row"><strong>${entry.weekdayLabel}</strong><span>${entry.startHour}:00 - ${entry.closeHour}:00</span></div>
        <div class="item-actions">
          <span class="pill">${entry.lunchStart && entry.lunchEnd ? `Lunch ${entry.lunchStart}-${entry.lunchEnd}` : "No lunch break set"}</span>
        </div>
      `;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "cancel-btn";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        try {
          await deleteRecurringTemplate(entry.weekday);
          weeklyMessage.className = "form-message";
          weeklyMessage.textContent = `${entry.weekdayLabel} recurring shift removed.`;
          await loadRecurringSummary();
          await loadScheduleForSelection();
          await loadCalendar();
        } catch (error) {
          if (isSchedulerAuthError(error)) {
            handleSchedulerAuthFailure();
            return;
          }
          weeklyMessage.className = "form-message error";
          weeklyMessage.textContent = error.message || "We couldn't remove that recurring shift.";
        }
      });

      item.appendChild(removeBtn);
      weeklySummary.appendChild(item);
    });
  }

  async function loadTimeOff() {
    timeoffList.innerHTML = "";
    const response = await getTimeOffBlocks(getSelectedBarberId());

    if (!response.items.length) {
      timeoffList.innerHTML = '<li class="booking-item">No holiday blocks saved.</li>';
      return;
    }

    response.items.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "booking-item";
      item.innerHTML = `
        <div class="booking-row"><strong>${entry.label}</strong><span>${entry.startDate} to ${entry.endDate}</span></div>
      `;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "cancel-btn";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", async () => {
        try {
          await deleteTimeOffBlock(entry.id);
          await loadTimeOff();
          await loadScheduleForSelection();
          await loadCalendar();
          await loadOverviewIfAllowed();
        } catch (error) {
          if (isSchedulerAuthError(error)) {
            handleSchedulerAuthFailure();
            return;
          }
          timeoffMessage.className = "form-message error";
          timeoffMessage.textContent = error.message || "We couldn't remove that time-off block.";
        }
      });

      item.appendChild(removeButton);
      timeoffList.appendChild(item);
    });
  }

  async function loadCalendar() {
    if (!getSelectedBarberId()) {
      calGrid.innerHTML = "";
      calMonthLabel.textContent = "";
      return;
    }

    const monthNames = ["January","February","March","April","May","June",
                        "July","August","September","October","November","December"];
    calMonthLabel.textContent = `${monthNames[calMonth - 1]} ${calYear}`;

    try {
      const data = await getMonthSchedule(calYear, calMonth, getSelectedBarberId());
      renderCalendar(data);
    } catch (_error) {
      calGrid.innerHTML = '<p style="grid-column:1/-1;font-size:0.8rem;color:var(--muted)">We couldn\'t load the calendar just now.</p>';
    }
  }

  function renderCalendar(data) {
    calGrid.innerHTML = "";

    const todayStr = formatDateInputValue(new Date());
    const selectedStr = dateInput.value;

    // ISO week: Mon=1 ... Sun=7, JS getDay: Sun=0 Mon=1 ... Sat=6
    // First day of month weekday offset (Mon-based grid)
    const firstDate = new Date(data.year, data.month - 1, 1);
    const startOffset = (firstDate.getDay() + 6) % 7; // Mon=0 ... Sun=6

    for (let i = 0; i < startOffset; i++) {
      const empty = document.createElement("div");
      empty.className = "cal-day cal-day--empty";
      empty.setAttribute("aria-hidden", "true");
      calGrid.appendChild(empty);
    }

    data.days.forEach((day) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day";
      btn.textContent = String(new Date(day.date + "T12:00:00").getDate());
      btn.setAttribute("aria-label", day.date + (day.isDayOff ? " — " + (day.label || "day off") : ""));

      if (day.isDayOff) {
        btn.classList.add("cal-day--off");
      } else if (day.source === "override") {
        btn.classList.add("cal-day--override");
      } else if (day.source === "weekly") {
        btn.classList.add("cal-day--weekly");
      }

      if (day.date === todayStr) {
        btn.classList.add("cal-day--today");
      }

      if (day.date === selectedStr) {
        btn.classList.add("cal-day--selected");
      }

      btn.addEventListener("click", async () => {
        dateInput.value = day.date;
        await loadScheduleForSelection();
        await loadOverviewIfAllowed();
        // Refresh selection highlight without refetching month
        calGrid.querySelectorAll(".cal-day--selected").forEach((el) => el.classList.remove("cal-day--selected"));
        btn.classList.add("cal-day--selected");
      });

      calGrid.appendChild(btn);
    });
  }

  calPrevBtn.addEventListener("click", async () => {
    calMonth -= 1;
    if (calMonth < 1) { calMonth = 12; calYear -= 1; }
    await loadCalendar();
  });

  calNextBtn.addEventListener("click", async () => {
    calMonth += 1;
    if (calMonth > 12) { calMonth = 1; calYear += 1; }
    await loadCalendar();
  });

  staffPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    passwordChangeMessage.className = "form-message";
    passwordChangeMessage.textContent = "";

    const currentPwdVal = document.getElementById("current-password").value;
    const newPwdVal = document.getElementById("new-password").value;
    const confirmPwdVal = document.getElementById("confirm-password").value;

    if (newPwdVal !== confirmPwdVal) {
      passwordChangeMessage.className = "form-message error";
      passwordChangeMessage.textContent = "Those new passwords don't match yet.";
      return;
    }

    if (newPwdVal.length < 8) {
      passwordChangeMessage.className = "form-message error";
      passwordChangeMessage.textContent = "Your new password needs to be at least 8 characters.";
      return;
    }

    try {
      await staffApiPut("/api/staff/password", { currentPassword: currentPwdVal, newPassword: newPwdVal });
      passwordChangeMessage.className = "form-message success";
      passwordChangeMessage.textContent = "Password updated. You're good to go.";
      staffPasswordForm.reset();
    } catch (error) {
      if (isStaffAuthError(error)) {
        handleSchedulerAuthFailure();
        return;
      }
      passwordChangeMessage.className = "form-message error";
      passwordChangeMessage.textContent = error.message || "We couldn't update your password just now.";
    }
  });

  async function loadOverviewIfAllowed() {
    if (currentMode !== "admin") {
      bookingsList.innerHTML = "";
      overviewMeta.textContent = "Bookings are visible only in admin mode.";
      return;
    }

    bookingsList.innerHTML = "";
    if (!getSelectedBarberId() || !dateInput.value) {
      bookingsList.innerHTML = '<li class="booking-item">Select barber and date to load bookings.</li>';
      return;
    }

    const response = await adminApiGet(
      `/api/admin/overview?date=${encodeURIComponent(dateInput.value)}&barberId=${encodeURIComponent(getSelectedBarberId())}`
    );

    overviewMeta.textContent = `${response.totalBookings} booking${response.totalBookings === 1 ? "" : "s"} on ${dateInput.value}.`;

    if (!response.bookings.length) {
      bookingsList.innerHTML = '<li class="booking-item">No bookings for this selection.</li>';
      return;
    }

    response.bookings.forEach((booking) => {
      const item = document.createElement("li");
      item.className = "booking-item";
      item.innerHTML = `
        <div class="booking-row"><strong>${booking.time}</strong><span>${booking.serviceName}</span></div>
        <div>${booking.name} • ${booking.phone}</div>
        <div class="booking-row"><span>${booking.barberName}</span><span>${booking.id}</span></div>
      `;

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "cancel-btn";
      cancelButton.textContent = "Cancel booking";
      cancelButton.addEventListener("click", async () => {
        try {
          await adminApiDelete(`/api/admin/bookings/${encodeURIComponent(booking.id)}`);
          await loadOverviewIfAllowed();
        } catch (error) {
          if (isAdminAuthError(error)) {
            handleSchedulerAuthFailure();
            return;
          }
          scheduleMessage.className = "form-message error";
          scheduleMessage.textContent = "Sorry, we couldn't cancel that booking.";
        }
      });

      item.appendChild(cancelButton);
      bookingsList.appendChild(item);
    });
  }

  async function getScheduleForDate(date, barberId) {
    if (currentMode === "staff") {
      return staffApiGet(`/api/staff/schedule?date=${encodeURIComponent(date)}`);
    }

    return adminApiGet(`/api/admin/schedule?date=${encodeURIComponent(date)}&barberId=${encodeURIComponent(barberId)}`);
  }

  async function saveScheduleOverride(payload) {
    if (currentMode === "staff") {
      return staffApiPut("/api/staff/schedule", {
        date: payload.date,
        startHour: payload.startHour,
        closeHour: payload.closeHour,
        blockedSlots: payload.blockedSlots
      });
    }

    return adminApiPut("/api/admin/schedule", payload);
  }

  async function deleteScheduleOverride(date, barberId) {
    if (currentMode === "staff") {
      return staffApiDelete(`/api/staff/schedule?date=${encodeURIComponent(date)}`);
    }

    return adminApiDelete(`/api/admin/schedule?date=${encodeURIComponent(date)}&barberId=${encodeURIComponent(barberId)}`);
  }

  async function getRecurringTemplates(barberId) {
    if (currentMode === "staff") {
      return staffApiGet("/api/staff/recurring-schedule");
    }

    return adminApiGet(`/api/admin/recurring-schedule?barberId=${encodeURIComponent(barberId)}`);
  }

  async function saveRecurringTemplate(payload) {
    if (currentMode === "staff") {
      return staffApiPut("/api/staff/recurring-schedule", {
        weekdays: payload.weekdays,
        startHour: payload.startHour,
        closeHour: payload.closeHour,
        lunchStart: payload.lunchStart,
        lunchEnd: payload.lunchEnd
      });
    }

    return adminApiPut("/api/admin/recurring-schedule", payload);
  }

  async function getTimeOffBlocks(barberId) {
    if (currentMode === "staff") {
      return staffApiGet("/api/staff/time-off");
    }

    return adminApiGet(`/api/admin/time-off?barberId=${encodeURIComponent(barberId)}`);
  }

  async function addHolidayBlock(payload) {
    if (currentMode === "staff") {
      return staffApiPost("/api/staff/time-off", {
        startDate: payload.startDate,
        endDate: payload.endDate,
        label: payload.label
      });
    }

    return adminApiPost("/api/admin/time-off", payload);
  }

  async function deleteTimeOffBlock(id) {
    if (currentMode === "staff") {
      return staffApiDelete(`/api/staff/time-off/${encodeURIComponent(id)}`);
    }

    return adminApiDelete(`/api/admin/time-off/${encodeURIComponent(id)}`);
  }

  async function deleteRecurringTemplate(weekday) {
    if (currentMode === "staff") {
      return staffApiDelete(`/api/staff/recurring-schedule?weekday=${encodeURIComponent(weekday)}`);
    }

    return adminApiDelete(`/api/admin/recurring-schedule?weekday=${encodeURIComponent(weekday)}&barberId=${encodeURIComponent(getSelectedBarberId())}`);
  }

  async function getMonthSchedule(year, month, barberId) {
    if (currentMode === "staff") {
      return staffApiGet(`/api/staff/schedule-month?year=${year}&month=${month}`);
    }

    return adminApiGet(`/api/admin/schedule-month?year=${year}&month=${month}&barberId=${encodeURIComponent(barberId)}`);
  }

  function handleSchedulerAuthFailure() {
    clearAdminToken();
    clearStaffToken();
    currentMode = null;
    currentStaff = null;
    exitDashboard();
  }

  function isSchedulerAuthError(error) {
    return isAdminAuthError(error) || isStaffAuthError(error);
  }
}

function hydrateSelect(selectElement, items, labelFormatter) {
  selectElement.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select";
  placeholder.selected = true;
  placeholder.disabled = true;
  selectElement.appendChild(placeholder);

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = labelFormatter(item);
    selectElement.appendChild(option);
  });
}

async function getCurrentCustomerSession() {
  if (!getCustomerToken()) {
    return null;
  }

  try {
    return await customerApiGet("/api/customer/me");
  } catch (_error) {
    clearCustomerToken();
    return null;
  }
}

async function apiGet(url) {
  const response = await fetch(url);
  return parseApiResponse(response);
}

async function apiPost(url, payload) {
  return apiPostWithHeaders(url, payload, {});
}

async function apiPut(url, payload) {
  return apiPutWithHeaders(url, payload, {});
}

async function apiDelete(url) {
  return apiDeleteWithHeaders(url, {});
}

async function parseApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  let body = null;
  let textBody = "";

  if (contentType.includes("application/json")) {
    body = await response.json();
  } else {
    textBody = (await response.text()).trim();
  }

  if (!response.ok) {
    const message =
      (body && (body.error || body.message)) ||
      textBody ||
      `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return body || null;
}

async function adminApiGet(url) {
  return apiGetWithHeaders(url, getAdminHeaders());
}

async function adminApiPost(url, payload) {
  return apiPostWithHeaders(url, payload, getAdminHeaders());
}

async function adminApiPut(url, payload) {
  return apiPutWithHeaders(url, payload, getAdminHeaders());
}

async function adminApiDelete(url) {
  return apiDeleteWithHeaders(url, getAdminHeaders());
}

async function staffApiGet(url) {
  return apiGetWithHeaders(url, getStaffHeaders());
}

async function staffApiPost(url, payload) {
  return apiPostWithHeaders(url, payload, getStaffHeaders());
}

async function staffApiPut(url, payload) {
  return apiPutWithHeaders(url, payload, getStaffHeaders());
}

async function staffApiDelete(url) {
  return apiDeleteWithHeaders(url, getStaffHeaders());
}

async function customerApiGet(url) {
  return apiGetWithHeaders(url, getCustomerHeaders());
}

async function customerApiPost(url, payload) {
  return apiPostWithHeaders(url, payload, getCustomerHeaders());
}

async function customerApiDelete(url) {
  return apiDeleteWithHeaders(url, getCustomerHeaders());
}

async function apiGetWithHeaders(url, extraHeaders) {
  let response;
  try {
    response = await fetch(resolveApiUrl(url), {
      headers: extraHeaders
    });
  } catch (_error) {
    const hint = window.location.protocol === "file:" ? " Make sure to open the app via http://localhost:3000 in your browser." : " Please refresh and try again.";
    throw new Error("Unable to reach the server." + hint);
  }
  return parseApiResponse(response);
}

async function apiPostWithHeaders(url, payload, extraHeaders) {
  let response;
  try {
    response = await fetch(resolveApiUrl(url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders
      },
      body: JSON.stringify(payload)
    });
  } catch (_error) {
    const hint = window.location.protocol === "file:" ? " Make sure to open the app via http://localhost:3000 in your browser." : " Please refresh and try again.";
    throw new Error("Unable to reach the server." + hint);
  }
  return parseApiResponse(response);
}

async function apiPutWithHeaders(url, payload, extraHeaders) {
  let response;
  try {
    response = await fetch(resolveApiUrl(url), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders
      },
      body: JSON.stringify(payload)
    });
  } catch (_error) {
    throw new Error("Unable to reach the server. Please refresh and try again.");
  }
  return parseApiResponse(response);
}

async function apiDeleteWithHeaders(url, extraHeaders) {
  let response;
  try {
    response = await fetch(resolveApiUrl(url), {
      method: "DELETE",
      headers: extraHeaders
    });
  } catch (_error) {
    throw new Error("Unable to reach the server. Please refresh and try again.");
  }

  if (response.status === 204) {
    return null;
  }

  return parseApiResponse(response);
}

function setAdminToken(token) {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

function clearAdminToken() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

function setStaffToken(token) {
  sessionStorage.setItem(STAFF_TOKEN_KEY, token);
}

function getStaffToken() {
  return sessionStorage.getItem(STAFF_TOKEN_KEY);
}

function clearStaffToken() {
  sessionStorage.removeItem(STAFF_TOKEN_KEY);
}

function setCustomerToken(token) {
  sessionStorage.setItem(CUSTOMER_TOKEN_KEY, token);
}

function getCustomerToken() {
  return sessionStorage.getItem(CUSTOMER_TOKEN_KEY);
}

function clearCustomerToken() {
  sessionStorage.removeItem(CUSTOMER_TOKEN_KEY);
}

function getAdminHeaders() {
  const token = getAdminToken();
  if (!token) {
    return {};
  }

  return {
    "x-admin-token": token
  };
}

function getStaffHeaders() {
  const token = getStaffToken();
  if (!token) {
    return {};
  }

  return {
    "x-staff-token": token
  };
}

function getCustomerHeaders() {
  const token = getCustomerToken();
  if (!token) {
    return {};
  }

  return {
    "x-customer-token": token
  };
}

function isAdminAuthError(error) {
  return Boolean(error && error.status === 401);
}

function isStaffAuthError(error) {
  return Boolean(error && error.status === 401);
}

function isCustomerAuthError(error) {
  return Boolean(error && error.status === 401);
}

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

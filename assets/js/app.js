document.addEventListener("DOMContentLoaded", () => {
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
const CUSTOMER_TOKEN_KEY = "northline.customer.token";

function resolveApiUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const path = url.startsWith("/") ? url : `/${url}`;
  const { protocol, hostname, port } = window.location;
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";

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
        formMessage.textContent = "Please complete all fields before confirming.";
        form.reportValidity();
        return;
      }

      if (!selectedSlotInput.value) {
        formMessage.classList.add("error");
        formMessage.textContent = "Choose an available time slot to continue.";
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
        formMessage.textContent = `Booked! Reference: ${booking.id}`;

        selectedSlotInput.value = "";
        await renderAvailableSlots();
        await renderMyBookings();
      } catch (error) {
        formMessage.classList.add("error");
        formMessage.textContent = error.message || "Unable to create booking.";
      }
    });

    await renderAvailableSlots();
    await renderMyBookings();
  } catch (_error) {
    slotMessage.textContent = "Booking service unavailable. Start the Node server and refresh.";
    formMessage.className = "form-message error";
    formMessage.textContent = "Could not connect to API.";
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
      slotMessage.textContent = "Choose a service, barber, and date to load slots.";
      return;
    }

    try {
      const availability = await apiGet(
        `/api/availability?date=${encodeURIComponent(selectedDate)}&barberId=${encodeURIComponent(selectedBarber)}&serviceId=${encodeURIComponent(selectedService)}`
      );

      slotMessage.textContent = availability.availableCount
        ? `Showing ${availability.availableCount} available slot${availability.availableCount > 1 ? "s" : ""}.`
        : "No times left for this date with that barber.";

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
      slotMessage.textContent = "Could not load available slots.";
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
            formMessage.textContent = error.message || "Unable to cancel booking.";
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
    loginMessage.textContent = "Portal opened on a preview host. API requests will be sent to localhost:3000.";
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
      loginMessage.textContent = response.message || "Email verified. You can now sign in.";
    } catch (error) {
      loginMessage.className = "form-message error";
      loginMessage.textContent = error.message || "Verification link is invalid or expired.";
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
      loginMessage.textContent = "Enter both email and password.";
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
      loginMessage.textContent = error.message || "Sign in failed.";
    }
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    registerMessage.className = "form-message";
    registerMessage.textContent = "";

    if (!registerForm.checkValidity()) {
      registerMessage.className = "form-message error";
      registerMessage.textContent = "Please complete all registration fields.";
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
        response.message || "Account created. Check your inbox for a verification link.";
      registerForm.reset();
    } catch (error) {
      registerMessage.className = "form-message error";
      registerMessage.textContent = error.message || "Registration failed.";
    }
  });

  resetRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    resetRequestMessage.className = "form-message";
    resetRequestMessage.textContent = "";

    if (!resetRequestForm.checkValidity()) {
      resetRequestMessage.className = "form-message error";
      resetRequestMessage.textContent = "Enter your account email.";
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
        response.message || "If the account exists, a reset link has been sent.";
      resetRequestForm.reset();
    } catch (error) {
      resetRequestMessage.className = "form-message error";
      resetRequestMessage.textContent = error.message || "Could not request password reset.";
    }
  });

  resendVerificationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    resendMessage.className = "form-message";
    resendMessage.textContent = "";

    if (!resendVerificationForm.checkValidity()) {
      resendMessage.className = "form-message error";
      resendMessage.textContent = "Enter your account email.";
      resendVerificationForm.reportValidity();
      return;
    }

    try {
      const payload = {
        email: resendVerificationForm.email.value.trim()
      };
      const response = await apiPost("/api/customer/resend-verification", payload);
      resendMessage.className = "form-message success";
      resendMessage.textContent = response.message || "Verification email sent.";
      resendVerificationForm.reset();
    } catch (error) {
      resendMessage.className = "form-message error";
      resendMessage.textContent = error.message || "Could not resend verification.";
    }
  });

  resetCompleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    resetCompleteMessage.className = "form-message";
    resetCompleteMessage.textContent = "";

    if (!resetToken) {
      resetCompleteMessage.className = "form-message error";
      resetCompleteMessage.textContent = "Reset token is missing.";
      return;
    }

    if (!resetCompleteForm.checkValidity()) {
      resetCompleteMessage.className = "form-message error";
      resetCompleteMessage.textContent = "Password must be at least 8 characters.";
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
      resetCompleteMessage.textContent = response.message || "Password updated successfully.";
      resetCompleteForm.reset();
    } catch (error) {
      resetCompleteMessage.className = "form-message error";
      resetCompleteMessage.textContent = error.message || "Could not reset password.";
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
    bookingsMeta.textContent = "Sign in to load your appointments.";
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
          bookingsMeta.textContent = error.message || "Could not cancel booking.";
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
  const loginForm = document.getElementById("admin-login-form");
  const passwordInput = document.getElementById("admin-password");
  const authMessage = document.getElementById("admin-auth-message");
  const logoutButton = document.getElementById("admin-logout-btn");
  const barberSelect = document.getElementById("admin-barber");
  const dateInput = document.getElementById("admin-date");
  const startHourInput = document.getElementById("start-hour");
  const closeHourInput = document.getElementById("close-hour");
  const slotGrid = document.getElementById("admin-slot-grid");
  const scheduleForm = document.getElementById("schedule-form");
  const scheduleMessage = document.getElementById("schedule-message");
  const clearOverrideButton = document.getElementById("clear-override-btn");
  const bookingsList = document.getElementById("admin-bookings-list");
  const overviewMeta = document.getElementById("overview-meta");

  if (
    !authWrap ||
    !dashboard ||
    !loginForm ||
    !passwordInput ||
    !authMessage ||
    !logoutButton ||
    !barberSelect ||
    !dateInput ||
    !startHourInput ||
    !closeHourInput ||
    !slotGrid ||
    !scheduleForm ||
    !scheduleMessage ||
    !clearOverrideButton ||
    !bookingsList ||
    !overviewMeta
  ) {
    return;
  }

  let slotSelection = new Set();

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authMessage.className = "form-message";
    authMessage.textContent = "";

    if (!loginForm.checkValidity()) {
      authMessage.className = "form-message error";
      authMessage.textContent = "Enter the admin password.";
      loginForm.reportValidity();
      return;
    }

    try {
      const response = await apiPost("/api/admin/login", { password: passwordInput.value });
      setAdminToken(response.token);
      passwordInput.value = "";
      await enterAdminDashboard();
    } catch (error) {
      authMessage.className = "form-message error";
      authMessage.textContent = error.message || "Sign-in failed.";
    }
  });

  logoutButton.addEventListener("click", async () => {
    try {
      await adminApiPost("/api/admin/logout", {});
    } catch (_error) {
      // Safe to ignore if already expired.
    }

    clearAdminToken();
    exitAdminDashboard();
  });

  if (getAdminToken()) {
    try {
      await adminApiGet("/api/admin/session");
      await enterAdminDashboard();
    } catch (_error) {
      clearAdminToken();
      exitAdminDashboard();
    }
  } else {
    exitAdminDashboard();
  }

  async function enterAdminDashboard() {
    authWrap.classList.add("hidden");
    dashboard.classList.remove("hidden");
    await bootstrapAdminData();
  }

  function exitAdminDashboard() {
    dashboard.classList.add("hidden");
    authWrap.classList.remove("hidden");
    authMessage.className = "form-message";
    authMessage.textContent = "";
  }

  async function bootstrapAdminData() {
    const barbers = await apiGet("/api/barbers");
    hydrateSelect(barberSelect, barbers, (barber) => barber.name);
    dateInput.min = formatDateInputValue(new Date());
    dateInput.value = formatDateInputValue(new Date());
    await loadScheduleForSelection();
    await loadAdminOverview();
  }

  barberSelect.addEventListener("change", async () => {
    await loadScheduleForSelection();
    await loadAdminOverview();
  });

  dateInput.addEventListener("change", async () => {
    await loadScheduleForSelection();
    await loadAdminOverview();
  });

  startHourInput.addEventListener("change", () => {
    renderAdminSlotToggles();
  });

  closeHourInput.addEventListener("change", () => {
    renderAdminSlotToggles();
  });

  clearOverrideButton.addEventListener("click", async () => {
    if (!barberSelect.value || !dateInput.value) {
      return;
    }

    try {
      await adminApiDelete(
        `/api/admin/schedule?date=${encodeURIComponent(dateInput.value)}&barberId=${encodeURIComponent(barberSelect.value)}`
      );
      scheduleMessage.className = "form-message success";
      scheduleMessage.textContent = "Override removed. Reverted to base hours.";
      await loadScheduleForSelection();
    } catch (error) {
      if (isAdminAuthError(error)) {
        clearAdminToken();
        exitAdminDashboard();
        return;
      }
      scheduleMessage.className = "form-message error";
      scheduleMessage.textContent = error.message || "Could not clear override.";
    }
  });

  scheduleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    scheduleMessage.className = "form-message";
    scheduleMessage.textContent = "";

    if (!scheduleForm.checkValidity()) {
      scheduleMessage.className = "form-message error";
      scheduleMessage.textContent = "Please complete all schedule fields.";
      scheduleForm.reportValidity();
      return;
    }

    const payload = {
      date: dateInput.value,
      barberId: barberSelect.value,
      startHour: Number(startHourInput.value),
      closeHour: Number(closeHourInput.value),
      blockedSlots: [...slotSelection]
    };

    try {
      await adminApiPut("/api/admin/schedule", payload);
      scheduleMessage.className = "form-message success";
      scheduleMessage.textContent = "Schedule override saved.";
      await loadScheduleForSelection();
      await loadAdminOverview();
    } catch (error) {
      if (isAdminAuthError(error)) {
        clearAdminToken();
        exitAdminDashboard();
        return;
      }
      scheduleMessage.className = "form-message error";
      scheduleMessage.textContent = error.message || "Could not save schedule.";
    }
  });

  async function loadScheduleForSelection() {
    if (!barberSelect.value || !dateInput.value) {
      slotGrid.innerHTML = "";
      return;
    }

    const response = await adminApiGet(
      `/api/admin/schedule?date=${encodeURIComponent(dateInput.value)}&barberId=${encodeURIComponent(barberSelect.value)}`
    );

    startHourInput.value = response.schedule.startHour;
    closeHourInput.value = response.schedule.closeHour;
    slotSelection = new Set(response.schedule.blockedSlots || []);
    renderAdminSlotToggles();
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

  async function loadAdminOverview() {
    bookingsList.innerHTML = "";

    if (!barberSelect.value || !dateInput.value) {
      bookingsList.innerHTML = '<li class="booking-item">Select barber and date to load bookings.</li>';
      return;
    }

    const response = await adminApiGet(
      `/api/admin/overview?date=${encodeURIComponent(dateInput.value)}&barberId=${encodeURIComponent(barberSelect.value)}`
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
          await loadAdminOverview();
        } catch (error) {
          if (isAdminAuthError(error)) {
            clearAdminToken();
            exitAdminDashboard();
            return;
          }
          scheduleMessage.className = "form-message error";
          scheduleMessage.textContent = "Unable to cancel booking.";
        }
      });

      item.appendChild(cancelButton);
      bookingsList.appendChild(item);
    });
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
    throw new Error("Unable to reach the server. Please refresh and try again.");
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
    throw new Error("Unable to reach the server. Please refresh and try again.");
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

function isCustomerAuthError(error) {
  return Boolean(error && error.status === 401);
}

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

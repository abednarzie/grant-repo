// Email + password authentication and the auth gate.
// Shows the login screen when signed out, the app when signed in, and wires
// up sign-in / sign-up / sign-out. Exposes onReady(callback) so main.js can
// (re)load data whenever a user becomes active.

import { supabase } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

const authView  = () => $("authView");
const appRoot   = () => $("appRoot");
const userEmail = () => $("userEmail");

let currentUser = null;
let readyCallback = null;

export function getUser() {
  return currentUser;
}

// Register the function main.js wants called when a user is signed in.
export function onReady(cb) {
  readyCallback = cb;
}

function showAuth() {
  authView().classList.remove("hidden");
  appRoot().classList.add("hidden");
}

function showApp() {
  authView().classList.add("hidden");
  appRoot().classList.remove("hidden");
  if (userEmail() && currentUser) userEmail().textContent = currentUser.email;
}

function authError(msg) {
  const box = $("authError");
  box.textContent = msg;
  box.classList.remove("hidden");
}

function clearAuthError() {
  const box = $("authError");
  box.textContent = "";
  box.classList.add("hidden");
}

// ── Wire up form + buttons ────────────────────────────────────────────────────

function initAuthUI() {
  const form = $("authForm");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAuthError();
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const mode = form.dataset.mode || "signin";

    if (!email || !password) {
      authError("Enter an email and password.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          // Email confirmation disabled → signed in immediately.
          // onAuthStateChange handles the transition.
        } else {
          authError("Check your email to confirm your account, then sign in.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // onAuthStateChange handles the transition.
      }
    } catch (err) {
      authError(err.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  });

  $("toggleMode").addEventListener("click", () => {
    const form = $("authForm");
    setMode(form.dataset.mode === "signup" ? "signin" : "signup");
    clearAuthError();
  });

  $("signOutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
}

function setMode(mode) {
  const form = $("authForm");
  form.dataset.mode = mode;
  if (mode === "signup") {
    $("authTitle").textContent = "Create your account";
    $("authSubmit").textContent = "Sign up";
    $("togglePrompt").textContent = "Already have an account?";
    $("toggleMode").textContent = "Sign in";
  } else {
    $("authTitle").textContent = "Sign in";
    $("authSubmit").textContent = "Sign in";
    $("togglePrompt").textContent = "Need an account?";
    $("toggleMode").textContent = "Sign up";
  }
}

function setBusy(busy) {
  $("authSubmit").disabled = busy;
  $("authSubmit").textContent = busy
    ? "…"
    : ($("authForm").dataset.mode === "signup" ? "Sign up" : "Sign in");
}

// ── Session lifecycle ─────────────────────────────────────────────────────────

export async function initAuth() {
  initAuthUI();
  setMode("signin");

  // React to future auth changes (sign in, sign out, token refresh).
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
      showApp();
      if (readyCallback) readyCallback();
    } else {
      showAuth();
    }
  });

  // Handle the current session on first load.
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user || null;
  if (currentUser) {
    showApp();
    if (readyCallback) readyCallback();
  } else {
    showAuth();
  }
}

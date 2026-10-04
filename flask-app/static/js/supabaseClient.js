// Initializes and exports the Supabase client.
// The URL + anon key come from window.APP_CONFIG, which is set by config.js
// (generated at build time from environment variables).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.APP_CONFIG || {};

if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  // Surface a clear message instead of a cryptic client error.
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML =
      '<div style="max-width:560px;margin:4rem auto;font-family:sans-serif;' +
      'padding:1.5rem;border:1px solid #fecaca;background:#fef2f2;border-radius:10px;color:#991b1b">' +
      "<h2 style='margin:0 0 .5rem'>Configuration missing</h2>" +
      "<p>SUPABASE_URL / SUPABASE_ANON_KEY are not set. Run " +
      "<code>node scripts/build-config.js</code> (locally with a .env file) " +
      "or set the environment variables in Netlify, then rebuild.</p></div>";
  });
  throw new Error("Missing Supabase configuration");
}

export const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

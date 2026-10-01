declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
  }
}
declare namespace Cloudflare {
  interface Env {
    OPENAI_API_KEY?: string;
    GITHUB_DISPATCH_TOKEN?: string;
    GITHUB_REPO?: string;
    OPENAI_MODEL?: string;
    /** Per-user AI spend cap per PKT month in USD (Monthly Picks); defaults to 1. */
    AI_MONTHLY_CAP_USD?: string;
  }
}
declare namespace Cloudflare {
  interface Env {
    ALLOWED_EMAILS?: string;
    PYPSX_API_KEY_ID?: string;
    PYPSX_API_SECRET_KEY?: string;
    PYPSX_OWNER_EMAIL?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    /** Comma-separated Google OAuth client IDs (iOS + Android) accepted as ID-token audiences from the native apps. */
    GOOGLE_MOBILE_CLIENT_IDS?: string;
    SESSION_SECRET?: string;
  }
}
declare namespace Cloudflare {
  interface Env {
    // Local development only (set in git-ignored `.dev.vars`): bypasses Google
    // OAuth for requests on a loopback host. Never set on the deployed Worker.
    DEV_AUTH_EMAIL?: string;
    DEV_AUTH_NAME?: string;
  }
}
declare namespace Cloudflare {
  interface Env {
    /** "staging" on the staging Worker (shows a STAGING badge); "production" otherwise. */
    APP_ENV?: string;
  }
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
  }
}
declare namespace Cloudflare {
  interface Env {
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
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

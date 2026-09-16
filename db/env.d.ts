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
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    SESSION_SECRET?: string;
  }
}

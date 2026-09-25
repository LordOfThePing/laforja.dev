declare module '@auth/core/types' {
  interface Session {
    user?: {
      googleId?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    googleId?: string;
  }
}

export {};

/** Password authentication must work before optional OAuth profile migrations. */
export const passwordLoginColumns = {
  id: true, email: true, passwordHash: true, role: true, name: true,
  locale: true, onboardingCompletedAt: true, accountStatus: true,
} as const;

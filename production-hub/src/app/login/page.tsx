import { loginAction } from "./actions";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid: "That email and password don't match.",
  locked: "Too many attempts. Try again in 15 minutes.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const sample = !process.env.DATABASE_URL;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-900 to-brand-700 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-lg font-black">PB</div>
          <h1 className="text-2xl font-bold">PB Painting</h1>
          <p className="text-sm text-brand-100">Production Hub · Crew Portal</p>
        </div>
        <form action={loginAction} className="card space-y-4 p-6">
          {error && ERRORS[error] && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{ERRORS[error]}</div>
          )}
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required className="input" />
          </div>
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
          </div>
          <button className="btn-primary w-full">Sign in</button>
        </form>
        {sample && (
          <div className="mt-4 rounded-lg bg-white/10 p-3 text-xs text-brand-50">
            <p className="font-semibold">Sample logins (password: PB-sample-2026)</p>
            <ul className="mt-1 space-y-0.5 font-mono">
              <li>owner@sample.pbhub.test</li>
              <li>coordinator@sample.pbhub.test</li>
              <li>crew@coastline-sample.test</li>
              <li>crew@mesa-sample.test</li>
              <li>crew@harbor-sample.test</li>
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

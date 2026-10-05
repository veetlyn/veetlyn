import Link from "next/link";

export default function InvalidResetLink() {
  return (
    <div className="space-y-2 text-sm">
      <p role="alert">This reset link is invalid or has expired.</p>
      <Link href="/forgot-password" className="underline underline-offset-4">
        Get a new link
      </Link>
    </div>
  );
}

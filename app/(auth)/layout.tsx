import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <div className="flex-1">
        <div className="container mx-auto flex min-h-svh max-w-md flex-col justify-center px-4 py-12">
          <Link
            href="/"
            className="mb-8 text-center font-heading text-2xl font-semibold"
          >
            Tracker
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}

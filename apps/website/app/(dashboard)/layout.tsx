import { UserButton } from "@clerk/nextjs";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <span className="font-semibold text-brand-700">
          StayWhile Operations
        </span>
        <UserButton />
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}

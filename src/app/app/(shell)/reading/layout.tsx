export default function ReadingLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5" data-module-layout="reading">
    {children}
  </div>;
}

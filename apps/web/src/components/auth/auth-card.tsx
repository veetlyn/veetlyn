export default function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="space-y-4 short:space-y-3">
      <div className="space-y-1.5 short:space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-3xl short:text-2xl">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-4 short:space-y-3">{children}</div>
      {footer ? <div className="space-y-1.5 text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

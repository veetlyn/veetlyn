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
    <div className="space-y-6 short:space-y-4">
      <div className="space-y-2 short:space-y-1">
        <h1 className="font-heading text-[28px] leading-tight tracking-[-0.02em] sm:text-[30px] short:text-[26px]">{title}</h1>
        {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-4 short:space-y-3">{children}</div>
      {footer ? <div className="space-y-1.5 text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

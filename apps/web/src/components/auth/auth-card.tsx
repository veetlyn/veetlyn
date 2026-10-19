import { BrandMark } from "@/components/brand-mark";

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
    <div className="space-y-6">
      <BrandMark className="mx-auto block size-10" />
      <div className="tray">
        <div className="panel space-y-6 p-6">
          <div className="space-y-1 text-center">
            <h1 className="font-[family-name:var(--font-display)] text-2xl">{title}</h1>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {children}
        </div>
      </div>
      {footer ? <div className="space-y-2 text-center text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

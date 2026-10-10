import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function TechnicalDetails({
  children,
  defaultOpen = false,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation("technical");
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details className="technical-details" open={open}>
      <summary
        className="technical-summary"
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        {open ? t("toggleHide") : t("toggleShow")}
      </summary>
      <div className="technical-body">{children}</div>
    </details>
  );
}

export function TechnicalRow({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <p className="tiny muted">
      <strong>{label}:</strong> {value}
    </p>
  );
}

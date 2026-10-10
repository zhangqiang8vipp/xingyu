"use client";

type TabOption<T extends string> = {
  id: T;
  label: string;
  description?: string;
};

/** One small navigation control for personal, team and organization surfaces. */
export default function AccountSectionTabs<T extends string>({
  label, tabs, active, onChange,
}: {
  label: string;
  tabs: readonly TabOption<T>[];
  active: T;
  onChange: (next: T) => void;
}) {
  return <nav aria-label={label} className="account-section-tabs">
    {tabs.map(tab => <button
      key={tab.id}
      className="account-section-tab"
      type="button"
      aria-pressed={active === tab.id}
      onClick={() => onChange(tab.id)}
    ><strong>{tab.label}</strong>{tab.description ? <small>{tab.description}</small> : null}</button>)}
  </nav>;
}

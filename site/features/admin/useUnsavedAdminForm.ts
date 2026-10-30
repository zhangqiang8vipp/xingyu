"use client";

import { useEffect } from "react";

/**
 * All editing surfaces use the same navigation contract. Do not force users to
 * relearn whether leaving Settings, About, Categories or Connect loses work.
 * This does not autosave or change backend permissions.
 */
export function useUnsavedAdminForm(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const beforeSectionChange = (event: Event) => {
      if (!window.confirm("这里还有未保存的更改。确定离开并放弃修改吗？")) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("xingyu:admin-before-section-change", beforeSectionChange);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("xingyu:admin-before-section-change", beforeSectionChange);
    };
  }, [dirty]);
}

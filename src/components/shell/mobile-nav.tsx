"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { UserRole } from "@prisma/client";

import { navSectionsFor } from "@/config/nav";

/**
 * The whole menu, on a phone.
 *
 * The terminal dashboard shows tiles for the daily work, which is right for the
 * counter — but staff standing in the office with only a phone need Subjects,
 * Grades, Streams, Reports and the rest too, and tiles do not carry them. This
 * is the SAME role-filtered config the sidebar renders; there is no second menu
 * and no second idea of who may see what.
 *
 * Rows are full-width and 48px so they can be hit with a thumb, and the drawer
 * closes on navigation — otherwise it would sit over the page it just opened.
 */
export function MobileNav({ role, username, roleLabel }: {
  role: UserRole;
  username: string;
  roleLabel: string;
}) {
  /**
   * The sections are built HERE, from the same config the sidebar uses, rather
   * than handed down as props: each item carries its icon COMPONENT, and a
   * function cannot cross the server/client boundary. Same config, same role
   * filter, one menu.
   */
  const sections = navSectionsFor(role);

  const pathname = usePathname();
  // The drawer is open "for" one path. When a tapped link changes the path its
  // job is over, so the open state is derived from that rather than closed by
  // an effect watching it — no cascading render, and the back button behaves.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenedAt(null); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="hover:bg-secondary grid size-11 shrink-0 place-items-center rounded-md lg:hidden"
      >
        <Menu className="size-6" aria-hidden />
      </button>

      {/*
        Portalled to <body>, not rendered in place. The header this button
        lives in has `backdrop-blur`, and in CSS a filter on an ancestor makes
        that ancestor the containing block for its `position: fixed`
        descendants — so an in-place drawer LOOKED full-screen but was really
        clipped to the 64px header, and taps on its lower rows fell through to
        the dashboard tiles underneath ("Payment" opened Attendance).
      */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex bg-black/40 lg:hidden"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <nav
            aria-label="Main"
            className="bg-sidebar text-sidebar-foreground flex h-full w-[86%] max-w-sm flex-col shadow-xl"
          >
            <div className="border-sidebar-border flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
              <span className="flex items-center gap-2">
                <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-md text-sm font-bold">
                  X
                </span>
                <span className="text-lg font-semibold tracking-tight">Xenon</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="hover:bg-secondary grid size-11 place-items-center rounded-md"
              >
                <X className="size-6" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
              {sections.map((section) => (
                <div key={section.heading ?? "_"}>
                  {section.heading && (
                    <p className="text-muted-foreground px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
                      {section.heading}
                    </p>
                  )}
                  <ul className="space-y-1">
                    {section.items.map((item) => (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          className="hover:bg-sidebar-accent flex min-h-12 items-center gap-3 rounded-md px-3 text-base"
                        >
                          <item.icon className="size-5 shrink-0" aria-hidden />
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="border-sidebar-border shrink-0 border-t px-4 py-3 text-sm">
              <p className="font-medium">{username}</p>
              <p className="text-muted-foreground text-xs">{roleLabel}</p>
            </div>
          </nav>
        </div>,
        document.body,
      )}
    </>
  );
}

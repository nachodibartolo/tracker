import {
  Folders,
  House,
  ListBullets,
  ArrowsLeftRight,
  Wallet,
  Gear,
  type Icon,
} from "@phosphor-icons/react";

import { t } from "@/lib/i18n";

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  showInBottomNav?: boolean;
}

export const navItems: NavItem[] = [
  { href: "/dashboard", label: t.nav.dashboard, icon: House, showInBottomNav: true },
  { href: "/transactions", label: t.nav.transactions, icon: ListBullets, showInBottomNav: true },
  { href: "/wallets", label: t.nav.wallets, icon: Wallet, showInBottomNav: true },
  { href: "/categories", label: t.nav.categories, icon: Folders, showInBottomNav: true },
  { href: "/transfers", label: t.nav.transfers, icon: ArrowsLeftRight },
  { href: "/settings", label: t.nav.settings, icon: Gear },
];

export const bottomNavItems = navItems.filter((i) => i.showInBottomNav);
export const moreNavItems = navItems.filter((i) => !i.showInBottomNav);

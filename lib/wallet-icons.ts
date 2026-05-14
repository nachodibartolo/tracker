import {
  Airplane,
  Bank,
  Briefcase,
  Coins,
  CreditCard,
  Coin,
  CurrencyDollarSimple,
  HouseLine,
  Money,
  PiggyBank,
  ShoppingBag,
  TrendUp,
  Vault,
  Wallet,
  type Icon,
} from "@phosphor-icons/react";

export const WALLET_ICONS: readonly { name: string; component: Icon }[] = [
  { name: "wallet", component: Wallet },
  { name: "bank", component: Bank },
  { name: "credit-card", component: CreditCard },
  { name: "piggy-bank", component: PiggyBank },
  { name: "vault", component: Vault },
  { name: "money", component: Money },
  { name: "coin", component: Coin },
  { name: "coins", component: Coins },
  { name: "currency-dollar", component: CurrencyDollarSimple },
  { name: "trend-up", component: TrendUp },
  { name: "briefcase", component: Briefcase },
  { name: "house-line", component: HouseLine },
  { name: "shopping-bag", component: ShoppingBag },
  { name: "airplane", component: Airplane },
] as const;

export const WALLET_ICON_NAMES = WALLET_ICONS.map((i) => i.name);

const iconMap = new Map(WALLET_ICONS.map((i) => [i.name, i.component]));

export function getWalletIcon(name: string): Icon {
  return iconMap.get(name) ?? Wallet;
}

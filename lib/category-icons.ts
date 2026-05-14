import {
  Airplane,
  Barbell,
  Bed,
  BeerStein,
  BookOpen,
  Briefcase,
  Buildings,
  Bus,
  Camera,
  Car,
  ChartLine,
  Coffee,
  Coin,
  CoinVertical,
  DeviceMobile,
  DotsThree,
  Drop,
  FilmStrip,
  FirstAid,
  Flame,
  Folder,
  ForkKnife,
  GasPump,
  Gift,
  GraduationCap,
  Hamburger,
  Heartbeat,
  House,
  Key,
  Laptop,
  Lightbulb,
  MoneyWavy,
  MusicNotes,
  PiggyBank,
  Pill,
  Plug,
  ShoppingBag,
  ShoppingCart,
  Sneaker,
  SoccerBall,
  Sparkle,
  Stethoscope,
  Storefront,
  TShirt,
  Tag,
  Taxi,
  Television,
  Ticket,
  TrendUp,
  Users,
  WifiHigh,
  Wrench,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";

export const CATEGORY_ICONS: readonly { name: string; component: Icon }[] = [
  // Comida
  { name: "fork-knife", component: ForkKnife },
  { name: "hamburger", component: Hamburger },
  { name: "coffee", component: Coffee },
  { name: "beer-stein", component: BeerStein },
  { name: "storefront", component: Storefront },
  { name: "shopping-cart", component: ShoppingCart },
  // Transporte
  { name: "car", component: Car },
  { name: "bus", component: Bus },
  { name: "gas-pump", component: GasPump },
  { name: "taxi", component: Taxi },
  { name: "ticket", component: Ticket },
  // Servicios
  { name: "plug", component: Plug },
  { name: "lightbulb", component: Lightbulb },
  { name: "flame", component: Flame },
  { name: "drop", component: Drop },
  { name: "wifi-high", component: WifiHigh },
  { name: "device-mobile", component: DeviceMobile },
  // Hogar
  { name: "house", component: House },
  { name: "key", component: Key },
  { name: "buildings", component: Buildings },
  { name: "wrench", component: Wrench },
  // Salud
  { name: "heartbeat", component: Heartbeat },
  { name: "pill", component: Pill },
  { name: "stethoscope", component: Stethoscope },
  { name: "first-aid", component: FirstAid },
  { name: "barbell", component: Barbell },
  // Entretenimiento
  { name: "film-strip", component: FilmStrip },
  { name: "music-notes", component: MusicNotes },
  { name: "users", component: Users },
  { name: "television", component: Television },
  { name: "soccer-ball", component: SoccerBall },
  // Compras
  { name: "shopping-bag", component: ShoppingBag },
  { name: "t-shirt", component: TShirt },
  { name: "sneaker", component: Sneaker },
  { name: "gift", component: Gift },
  // Educación
  { name: "book-open", component: BookOpen },
  { name: "graduation-cap", component: GraduationCap },
  { name: "folder", component: Folder },
  // Viajes
  { name: "airplane", component: Airplane },
  { name: "bed", component: Bed },
  { name: "camera", component: Camera },
  // Income
  { name: "briefcase", component: Briefcase },
  { name: "laptop", component: Laptop },
  { name: "trend-up", component: TrendUp },
  { name: "money-wavy", component: MoneyWavy },
  { name: "coin", component: Coin },
  { name: "coin-vertical", component: CoinVertical },
  { name: "chart-line", component: ChartLine },
  { name: "piggy-bank", component: PiggyBank },
  // Misc / fallback
  { name: "sparkle", component: Sparkle },
  { name: "tag", component: Tag },
  { name: "dots-three", component: DotsThree },
] as const;

export const CATEGORY_ICON_NAMES = CATEGORY_ICONS.map((i) => i.name);

const iconMap = new Map(CATEGORY_ICONS.map((i) => [i.name, i.component]));

export function getCategoryIcon(name: string): Icon {
  return iconMap.get(name) ?? Tag;
}

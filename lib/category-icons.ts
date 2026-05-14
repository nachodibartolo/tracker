import {
  Airplane,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Coffee,
  DotsThree,
  FilmStrip,
  ForkKnife,
  Gift,
  Hamburger,
  Heartbeat,
  House,
  Laptop,
  Plug,
  ShoppingBag,
  SoccerBall,
  Sparkle,
  Tag,
  TrendUp,
  type Icon,
} from "@phosphor-icons/react/dist/ssr";

export const CATEGORY_ICONS: readonly { name: string; component: Icon }[] = [
  { name: "fork-knife", component: ForkKnife },
  { name: "hamburger", component: Hamburger },
  { name: "coffee", component: Coffee },
  { name: "car", component: Car },
  { name: "bus", component: Bus },
  { name: "plug", component: Plug },
  { name: "house", component: House },
  { name: "heartbeat", component: Heartbeat },
  { name: "film-strip", component: FilmStrip },
  { name: "soccer-ball", component: SoccerBall },
  { name: "shopping-bag", component: ShoppingBag },
  { name: "book-open", component: BookOpen },
  { name: "airplane", component: Airplane },
  { name: "gift", component: Gift },
  { name: "sparkle", component: Sparkle },
  { name: "briefcase", component: Briefcase },
  { name: "laptop", component: Laptop },
  { name: "trend-up", component: TrendUp },
  { name: "tag", component: Tag },
  { name: "dots-three", component: DotsThree },
] as const;

export const CATEGORY_ICON_NAMES = CATEGORY_ICONS.map((i) => i.name);

const iconMap = new Map(CATEGORY_ICONS.map((i) => [i.name, i.component]));

export function getCategoryIcon(name: string): Icon {
  return iconMap.get(name) ?? Tag;
}

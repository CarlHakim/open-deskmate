'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Folder,
  Briefcase,
  Code,
  FileText,
  Image,
  Music,
  Video,
  Database,
  Globe,
  Mail,
  MessageSquare,
  Phone,
  Calendar,
  Clock,
  Star,
  Heart,
  Bookmark,
  Tag,
  Flag,
  Zap,
  Rocket,
  Target,
  Trophy,
  Gift,
  ShoppingCart,
  CreditCard,
  DollarSign,
  PieChart,
  BarChart,
  TrendingUp,
  Users,
  User,
  Home,
  Building,
  Car,
  Plane,
  Map,
  Compass,
  Sun,
  Moon,
  Cloud,
  Umbrella,
  Coffee,
  Pizza,
  Apple,
  Leaf,
  Flower2,
  Bug,
  Gamepad2,
  Headphones,
  Camera,
  Tv,
  Monitor,
  Smartphone,
  Tablet,
  Watch,
  Cpu,
  HardDrive,
  Wifi,
  Bluetooth,
  Battery,
  Lightbulb,
  Wrench,
  Hammer,
  Scissors,
  Paintbrush,
  Pen,
  Pencil,
  Eraser,
  Ruler,
  Calculator,
  Book,
  GraduationCap,
  School,
  Library,
  Microscope,
  FlaskConical,
  Atom,
  Dna,
  Activity,
  Stethoscope,
  Pill,
  Syringe,
  type LucideIcon,
} from 'lucide-react';

export const PROJECT_ICONS: { name: string; icon: LucideIcon }[] = [
  { name: 'Folder', icon: Folder },
  { name: 'Briefcase', icon: Briefcase },
  { name: 'Code', icon: Code },
  { name: 'FileText', icon: FileText },
  { name: 'Image', icon: Image },
  { name: 'Music', icon: Music },
  { name: 'Video', icon: Video },
  { name: 'Database', icon: Database },
  { name: 'Globe', icon: Globe },
  { name: 'Mail', icon: Mail },
  { name: 'MessageSquare', icon: MessageSquare },
  { name: 'Phone', icon: Phone },
  { name: 'Calendar', icon: Calendar },
  { name: 'Clock', icon: Clock },
  { name: 'Star', icon: Star },
  { name: 'Heart', icon: Heart },
  { name: 'Bookmark', icon: Bookmark },
  { name: 'Tag', icon: Tag },
  { name: 'Flag', icon: Flag },
  { name: 'Zap', icon: Zap },
  { name: 'Rocket', icon: Rocket },
  { name: 'Target', icon: Target },
  { name: 'Trophy', icon: Trophy },
  { name: 'Gift', icon: Gift },
  { name: 'ShoppingCart', icon: ShoppingCart },
  { name: 'CreditCard', icon: CreditCard },
  { name: 'DollarSign', icon: DollarSign },
  { name: 'PieChart', icon: PieChart },
  { name: 'BarChart', icon: BarChart },
  { name: 'TrendingUp', icon: TrendingUp },
  { name: 'Users', icon: Users },
  { name: 'User', icon: User },
  { name: 'Home', icon: Home },
  { name: 'Building', icon: Building },
  { name: 'Car', icon: Car },
  { name: 'Plane', icon: Plane },
  { name: 'Map', icon: Map },
  { name: 'Compass', icon: Compass },
  { name: 'Sun', icon: Sun },
  { name: 'Moon', icon: Moon },
  { name: 'Cloud', icon: Cloud },
  { name: 'Umbrella', icon: Umbrella },
  { name: 'Coffee', icon: Coffee },
  { name: 'Pizza', icon: Pizza },
  { name: 'Apple', icon: Apple },
  { name: 'Leaf', icon: Leaf },
  { name: 'Flower2', icon: Flower2 },
  { name: 'Bug', icon: Bug },
  { name: 'Gamepad2', icon: Gamepad2 },
  { name: 'Headphones', icon: Headphones },
  { name: 'Camera', icon: Camera },
  { name: 'Tv', icon: Tv },
  { name: 'Monitor', icon: Monitor },
  { name: 'Smartphone', icon: Smartphone },
  { name: 'Tablet', icon: Tablet },
  { name: 'Watch', icon: Watch },
  { name: 'Cpu', icon: Cpu },
  { name: 'HardDrive', icon: HardDrive },
  { name: 'Wifi', icon: Wifi },
  { name: 'Bluetooth', icon: Bluetooth },
  { name: 'Battery', icon: Battery },
  { name: 'Lightbulb', icon: Lightbulb },
  { name: 'Wrench', icon: Wrench },
  { name: 'Hammer', icon: Hammer },
  { name: 'Scissors', icon: Scissors },
  { name: 'Paintbrush', icon: Paintbrush },
  { name: 'Pen', icon: Pen },
  { name: 'Pencil', icon: Pencil },
  { name: 'Eraser', icon: Eraser },
  { name: 'Ruler', icon: Ruler },
  { name: 'Calculator', icon: Calculator },
  { name: 'Book', icon: Book },
  { name: 'GraduationCap', icon: GraduationCap },
  { name: 'School', icon: School },
  { name: 'Library', icon: Library },
  { name: 'Microscope', icon: Microscope },
  { name: 'FlaskConical', icon: FlaskConical },
  { name: 'Atom', icon: Atom },
  { name: 'Dna', icon: Dna },
  { name: 'Activity', icon: Activity },
  { name: 'Stethoscope', icon: Stethoscope },
  { name: 'Pill', icon: Pill },
  { name: 'Syringe', icon: Syringe },
];

export const PROJECT_COLORS = [
  { name: 'Default', value: undefined },
  { name: 'Teal', value: '#4db6ac' },
  { name: 'Blue', value: '#5c9eff' },
  { name: 'Purple', value: '#a78bfa' },
  { name: 'Pink', value: '#f472b6' },
  { name: 'Orange', value: '#fb923c' },
  { name: 'Yellow', value: '#fbbf24' },
  { name: 'Green', value: '#4ade80' },
  { name: 'Red', value: '#f87171' },
  { name: 'Indigo', value: '#818cf8' },
  { name: 'Cyan', value: '#22d3ee' },
  { name: 'Lime', value: '#a3e635' },
];

interface ProjectIconPickerProps {
  selectedIcon: string;
  selectedColor: string | undefined;
  onIconChange: (icon: string) => void;
  onColorChange: (color: string | undefined) => void;
}

export default function ProjectIconPicker({
  selectedIcon,
  selectedColor,
  onIconChange,
  onColorChange,
}: ProjectIconPickerProps) {
  const [activeTab, setActiveTab] = useState<'icon' | 'color'>('icon');

  // Get the selected icon component
  const SelectedIconComponent = PROJECT_ICONS.find((i) => i.name === selectedIcon)?.icon || Folder;

  return (
    <div className="space-y-3">
      {/* Preview */}
      <div className="flex items-center justify-center">
        <div
          className={cn(
            'flex items-center justify-center w-16 h-16 rounded-xl',
            'border-2 border-border/50 transition-all duration-200'
          )}
          style={{
            backgroundColor: selectedColor ? `${selectedColor}20` : 'hsl(var(--muted))',
          }}
        >
          <SelectedIconComponent
            className="h-8 w-8"
            style={{ color: selectedColor || 'hsl(var(--muted-foreground))' }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/50">
        <button
          type="button"
          onClick={() => setActiveTab('icon')}
          className={cn(
            'flex-1 py-2 text-sm font-medium transition-colors',
            activeTab === 'icon'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Icon
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('color')}
          className={cn(
            'flex-1 py-2 text-sm font-medium transition-colors',
            activeTab === 'color'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Color
        </button>
      </div>

      {/* Content */}
      {activeTab === 'icon' ? (
        <ScrollArea className="h-[200px]">
          <div className="grid grid-cols-8 gap-1 p-1">
            {PROJECT_ICONS.map(({ name, icon: Icon }) => (
              <button
                key={name}
                type="button"
                onClick={() => onIconChange(name)}
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200',
                  'hover:bg-accent hover:scale-110',
                  selectedIcon === name
                    ? 'bg-primary/10 ring-2 ring-primary/30'
                    : 'bg-transparent'
                )}
                title={name}
              >
                <Icon
                  className="h-4 w-4"
                  style={{ color: selectedColor || 'hsl(var(--muted-foreground))' }}
                />
              </button>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="grid grid-cols-6 gap-2 p-1">
          {PROJECT_COLORS.map((color) => (
            <button
              key={color.name}
              type="button"
              onClick={() => onColorChange(color.value)}
              className={cn(
                'w-10 h-10 rounded-lg border-2 transition-all duration-200 hover:scale-110',
                selectedColor === color.value
                  ? 'border-primary ring-2 ring-primary/20'
                  : 'border-border/50 hover:border-border'
              )}
              style={{
                backgroundColor: color.value || 'hsl(var(--muted))',
              }}
              title={color.name}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Helper function to get icon component by name
export function getIconByName(name: string): LucideIcon {
  return PROJECT_ICONS.find((i) => i.name === name)?.icon || Folder;
}

import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  GripVertical,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Settings2,
  TrendingUp,
  BarChart2,
  Target,
  Settings,
  BookOpen,
  Shield,
  Eye,
  Upload,
  Brain,
  Activity,
  Zap,
  Microscope,
  Wallet,
  GraduationCap,
  HelpCircle,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavigationLayoutType, NavigationGroupType, NavigationItemType } from "@shared/schema";

const iconMap: Record<string, any> = {
  Activity,
  TrendingUp,
  Eye,
  Target,
  Upload,
  BarChart2,
  Brain,
  BookOpen,
  Settings,
  Shield,
  Zap,
  Microscope,
  Wallet,
  GraduationCap,
  HelpCircle,
};

const defaultNavItems: NavigationItemType[] = [
  { id: "terminal", title: "Terminal", icon: "Activity", href: "/t" },
  { id: "gex", title: "GEX", icon: "Zap", href: "/t?tab=gex" },
  { id: "research", title: "Research", icon: "Microscope", href: "/r" },
  { id: "positions", title: "Positions", icon: "Wallet", href: "/t?tab=positions" },
  { id: "journal", title: "Journal", icon: "BookOpen", href: "/t?tab=journal" },
  { id: "slate", title: "Slate", icon: "TrendingUp", href: "/slate" },
  { id: "radar", title: "Thesis Radar", icon: "Target", href: "/radar" },
  { id: "alerts", title: "Alerts", icon: "Bell", href: "/alerts" },
  { id: "academy", title: "Academy", icon: "GraduationCap", href: "/academy" },
  { id: "how-to", title: "How to use", icon: "HelpCircle", href: "/how-to" },
  { id: "blog", title: "Blog", icon: "BookOpen", href: "/blog" },
  { id: "settings", title: "Settings", icon: "Settings", href: "/settings" },
  { id: "admin", title: "Admin", icon: "Shield", href: "/admin", adminOnly: true },
];

const defaultLayout: NavigationLayoutType = {
  version: 1,
  groups: [
    {
      id: "trading",
      title: "Trading",
      items: defaultNavItems.filter(i => ["command-center", "trade-desk", "watchlist"].includes(i.id)),
    },
    {
      id: "analytics",
      title: "Analytics",
      items: defaultNavItems.filter(i => ["performance", "chart-analysis", "options", "trends", "historical"].includes(i.id)),
    },
    {
      id: "learn",
      title: "Learn",
      items: defaultNavItems.filter(i => ["academy", "blog"].includes(i.id)),
    },
    {
      id: "account",
      title: "Account",
      items: defaultNavItems.filter(i => ["settings"].includes(i.id)),
    },
  ],
};

function SortableNavItem({ item, onRemove }: { item: NavigationItemType; onRemove: () => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const IconComponent = iconMap[item.icon] || Settings2;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 p-2 rounded-md bg-muted/50 border border-border/50",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>
      <IconComponent className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 text-sm">{item.title}</span>
      {item.badge && (
        <Badge variant="outline" className="text-xs bg-emerald-500/15 text-[var(--trade-bullish)] border-emerald-500/30">
          {item.badge}
        </Badge>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="h-6 w-6 opacity-50 hover:opacity-100"
        data-testid={`btn-remove-${item.id}`}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function NavItemPreview({ item }: { item: NavigationItemType }) {
  const IconComponent = iconMap[item.icon] || Settings2;
  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-muted border border-primary shadow-lg">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <IconComponent className="h-4 w-4" />
      <span className="text-sm font-medium">{item.title}</span>
    </div>
  );
}

function NavigationGroup({
  group,
  onUpdate,
  onRemove,
  allItems,
}: {
  group: NavigationGroupType;
  onUpdate: (updated: NavigationGroupType) => void;
  onRemove: () => void;
  allItems: NavigationItemType[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(group.title);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = group.items.findIndex((i) => i.id === active.id);
      const newIndex = group.items.findIndex((i) => i.id === over.id);
      const newItems = arrayMove(group.items, oldIndex, newIndex);
      onUpdate({ ...group, items: newItems });
    }
  };

  const handleRemoveItem = (itemId: string) => {
    onUpdate({ ...group, items: group.items.filter((i) => i.id !== itemId) });
  };

  const handleTitleSave = () => {
    onUpdate({ ...group, title });
    setIsEditing(false);
  };

  const availableItems = allItems.filter(
    (item) => !group.items.some((gi) => gi.id === item.id)
  );

  return (
    <Card className="mb-3">
      <CardHeader className="py-2 px-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="h-6 w-6"
            data-testid={`btn-toggle-group-${group.id}`}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
          {isEditing ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-7 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleTitleSave()}
                data-testid={`input-group-title-${group.id}`}
              />
              <Button size="sm" onClick={handleTitleSave} className="h-7">
                Save
              </Button>
            </div>
          ) : (
            <CardTitle
              className="text-sm font-medium cursor-pointer flex-1"
              onClick={() => setIsEditing(true)}
            >
              {group.title}
            </CardTitle>
          )}
          <Badge variant="secondary" className="text-xs">
            {group.items.length} items
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="h-6 w-6 text-destructive"
            data-testid={`btn-remove-group-${group.id}`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="py-2 px-3 space-y-2">
          <DndContext
            sensors={useSensors(
              useSensor(PointerSensor),
              useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
            )}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={group.items.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1">
                {group.items.map((item) => (
                  <SortableNavItem
                    key={item.id}
                    item={item}
                    onRemove={() => handleRemoveItem(item.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {availableItems.length > 0 && (
            <div className="pt-2 border-t border-border/50">
              <p className="text-xs text-muted-foreground mb-2">Add items:</p>
              <div className="flex flex-wrap gap-1">
                {availableItems.slice(0, 5).map((item) => (
                  <Button
                    key={item.id}
                    variant="outline"
                    size="sm"
                    onClick={() => onUpdate({ ...group, items: [...group.items, item] })}
                    className="h-6 text-xs"
                    data-testid={`btn-add-${item.id}-to-${group.id}`}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {item.title}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function NavigationCustomizer() {
  const { toast } = useToast();
  const [activeItem, setActiveItem] = useState<NavigationItemType | null>(null);
  const [layout, setLayout] = useState<NavigationLayoutType>(defaultLayout);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: savedLayout, isLoading } = useQuery<{ layout: NavigationLayoutType } | null>({
    queryKey: ["/api/navigation-layout"],
  });

  useState(() => {
    if (savedLayout?.layout) {
      setLayout(savedLayout.layout);
    }
  });

  const saveMutation = useMutation({
    mutationFn: async (newLayout: NavigationLayoutType) => {
      return apiRequest("PUT", "/api/navigation-layout", { layout: newLayout });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/navigation-layout"] });
      setHasChanges(false);
      toast({ title: "Navigation saved", description: "Your navigation layout has been saved." });
    },
    onError: (error: any) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", "/api/navigation-layout");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/navigation-layout"] });
      setLayout(defaultLayout);
      setHasChanges(false);
      toast({ title: "Navigation reset", description: "Navigation has been reset to defaults." });
    },
  });

  const handleGroupUpdate = useCallback((groupId: string, updated: NavigationGroupType) => {
    setLayout((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === groupId ? updated : g)),
    }));
    setHasChanges(true);
  }, []);

  const handleGroupRemove = useCallback((groupId: string) => {
    setLayout((prev) => ({
      ...prev,
      groups: prev.groups.filter((g) => g.id !== groupId),
    }));
    setHasChanges(true);
  }, []);

  const handleAddGroup = useCallback(() => {
    const newGroup: NavigationGroupType = {
      id: `group-${Date.now()}`,
      title: "New Group",
      items: [],
    };
    setLayout((prev) => ({
      ...prev,
      groups: [...prev.groups, newGroup],
    }));
    setHasChanges(true);
  }, []);

  const usedItemIds = layout.groups.flatMap((g) => g.items.map((i) => i.id));
  const allAvailableItems = defaultNavItems.filter((i) => !usedItemIds.includes(i.id));

  if (isLoading) {
    return <div className="p-4 text-muted-foreground">Loading navigation settings...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Customize Navigation</h3>
          <p className="text-sm text-muted-foreground">
            Drag items to reorder, create groups, or rename sections.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
            data-testid="btn-reset-navigation"
          >
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate(layout)}
            disabled={!hasChanges || saveMutation.isPending}
            data-testid="btn-save-navigation"
          >
            <Save className="h-4 w-4 mr-1" />
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {layout.groups.map((group) => (
          <NavigationGroup
            key={group.id}
            group={group}
            onUpdate={(updated) => handleGroupUpdate(group.id, updated)}
            onRemove={() => handleGroupRemove(group.id)}
            allItems={defaultNavItems}
          />
        ))}
      </div>

      <Button
        variant="outline"
        onClick={handleAddGroup}
        className="w-full"
        data-testid="btn-add-group"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add New Group
      </Button>

      {allAvailableItems.length > 0 && (
        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm">Unused Items</CardTitle>
          </CardHeader>
          <CardContent className="py-2 px-3">
            <div className="flex flex-wrap gap-2">
              {allAvailableItems.map((item) => {
                const IconComponent = iconMap[item.icon] || Settings2;
                return (
                  <Badge key={item.id} variant="outline" className="py-1 px-2">
                    <IconComponent className="h-3 w-3 mr-1" />
                    {item.title}
                  </Badge>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

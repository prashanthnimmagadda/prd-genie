import { useRef } from 'react';
import {
  Check,
  ChevronsUpDown,
  FileText,
  History,
  ListTree,
  MessageSquare,
  PanelLeft,
  Paperclip,
  SlidersHorizontal,
} from 'lucide-react';
import type { PrdSection, ProjectSummary } from '@shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { sectionNumber } from '@/lib/format';

import { destinationTitles, type Destination } from '@/lib/destinations';

interface SidebarProps {
  projects: ProjectSummary[];
  project: ProjectSummary;
  destination: Destination;
  sections: PrdSection[];
  selectedSectionId: string;
  pendingSectionId: string | null;
  sourceCount: number;
  width: number;
  overlay: boolean;
  disabled: boolean;
  onNavigate: (destination: Destination) => void;
  onSelectSection: (sectionId: string) => void;
  onProjectSelect: (id: string) => void;
  onNewProject: () => void;
  onImport: () => void;
  onRename: () => void;
  onDelete: () => void;
  onHide: () => void;
  onWidthChange: (width: number) => void;
}

export function Sidebar({
  projects,
  project,
  destination,
  sections,
  selectedSectionId,
  pendingSectionId,
  sourceCount,
  width,
  overlay,
  disabled,
  onNavigate,
  onSelectSection,
  onProjectSelect,
  onNewProject,
  onImport,
  onRename,
  onDelete,
  onHide,
  onWidthChange,
}: SidebarProps) {
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null);
  const items: Array<{ id: Destination; icon: typeof MessageSquare; badge?: string }> = [
    { id: 'conversation', icon: MessageSquare },
    { id: 'document', icon: FileText },
    { id: 'sources', icon: Paperclip, badge: sourceCount ? String(sourceCount) : undefined },
    { id: 'history', icon: History },
  ];
  const bottom: Array<{ id: Destination; icon: typeof MessageSquare }> = [
    { id: 'structures', icon: ListTree },
    { id: 'settings', icon: SlidersHorizontal },
  ];

  function renderItem({
    id,
    icon: Icon,
    badge,
  }: {
    id: Destination;
    icon: typeof MessageSquare;
    badge?: string;
  }) {
    const current = destination === id;
    return (
      <li key={id}>
        <button
          type="button"
          className="sidebar-item"
          aria-current={current ? 'page' : undefined}
          aria-description={id === 'sources' && sourceCount ? `${sourceCount} sources` : undefined}
          onClick={() => onNavigate(id)}
        >
          <Icon aria-hidden="true" />
          <span>{destinationTitles[id]}</span>
          {badge && (
            <span className="badge" aria-hidden="true">
              {badge}
            </span>
          )}
        </button>
        {id === 'document' && current && sections.length > 0 && (
          <ul className="sidebar-outline" aria-label="Outline">
            {sections.map((section, index) => {
              const empty = !section.body.trim();
              const tag =
                section.id === pendingSectionId
                  ? 'Change pending'
                  : empty && section.required
                    ? 'Required'
                    : empty
                      ? 'Empty'
                      : '';
              return (
                <li key={section.id}>
                  <a
                    href={`#section-${section.id}`}
                    aria-current={section.id === selectedSectionId ? 'true' : undefined}
                    title={section.title}
                    onClick={() => onSelectSection(section.id)}
                  >
                    <span className="num">{sectionNumber(index)}</span>
                    <span className="name truncate">{section.title}</span>
                    {tag && (
                      <span
                        className={`tag ${tag === 'Required' ? 'warning' : tag === 'Change pending' ? 'accent' : ''}`}
                      >
                        {tag}
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  }

  return (
    <nav className="sidebar" aria-label="Sidebar" style={{ width }}>
      <div className="sidebar-head">
        <button
          type="button"
          className="btn btn-icon"
          aria-label="Hide sidebar"
          aria-expanded="true"
          aria-keyshortcuts="Control+Meta+S"
          onClick={onHide}
        >
          <PanelLeft aria-hidden="true" />
        </button>
      </div>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="project-button"
            aria-label={`Project: ${project.name}. Show project menu`}
            title={project.name}
            disabled={disabled}
          >
            <span className="truncate">{project.name}</span>
            <ChevronsUpDown aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="genie-menu"
          align="start"
          sideOffset={2}
          style={{ width: 280 }}
        >
          {projects.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => {
                if (item.id !== project.id) onProjectSelect(item.id);
              }}
            >
              <span className="mark">{item.id === project.id && <Check aria-hidden="true" />}</span>
              <span className="grow" title={item.name}>
                {item.name}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator className="menu-sep" />
          <DropdownMenuItem onSelect={onNewProject}>
            <span className="mark" />
            <span className="grow">New project</span>
            <span className="shortcut" aria-hidden="true">
              ⌘N
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onImport}>
            <span className="mark" />
            <span className="grow">Import PRD or archive…</span>
            <span className="shortcut" aria-hidden="true">
              ⌘O
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="menu-sep" />
          <DropdownMenuItem onSelect={onRename}>
            <span className="mark" />
            <span className="grow">Rename…</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete}>
            <span className="mark" />
            <span className="grow">Delete project…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ul className="sidebar-list">{items.map(renderItem)}</ul>
      <div className="sidebar-spacer" />
      <ul className="sidebar-list bottom">{bottom.map(renderItem)}</ul>
      {!overlay && (
        <div
          className="sidebar-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={200}
          aria-valuemax={320}
          aria-valuenow={width}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') onWidthChange(Math.max(200, width - 8));
            if (event.key === 'ArrowRight') onWidthChange(Math.min(320, width + 8));
          }}
          onPointerDown={(event) => {
            dragging.current = { startX: event.clientX, startWidth: width };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!dragging.current) return;
            const next = dragging.current.startWidth + (event.clientX - dragging.current.startX);
            onWidthChange(Math.min(320, Math.max(200, Math.round(next))));
          }}
          onPointerUp={() => {
            dragging.current = null;
          }}
        />
      )}
    </nav>
  );
}

import React, {useEffect, useRef} from 'react';
import {BookOpen, Code2, Network, BrainCircuit, Sparkles, ArrowRight, Check, CalendarClock, Clock3} from 'lucide-react';
import type {Course, Chapter} from '../shared';
import {ratings} from '../shared';

const icons: Record<string, typeof BookOpen> = {book: BookOpen, code: Code2, network: Network, brain: BrainCircuit, sparkles: Sparkles};

// Presentation-only colors: upgrading the interface never rewrites stored courses.
export function courseTheme(course?: Course): React.CSSProperties {
  const [color, deep] = [course?.color || '#347ce5', 'color-mix(in srgb, '+(course?.color || '#347ce5')+' 75%, #152e55)'];
  return {'--course-color': color, '--course-deep': deep} as React.CSSProperties;
}

export function CourseIcon({course, size = 24}: {course: Course; size?: number}) {
  const Icon = icons[course.icon] || BookOpen;
  return <span className="course-icon" style={courseTheme(course)}><Icon size={size}/></span>;
}

function percentage(value: number) { return Math.round(Math.max(0, Math.min(1, value)) * 100); }
function progress(chapters: Chapter[]) {
  const done = chapters.filter(c => c.reviews > 0).length;
  return {done, total: chapters.length, percent: chapters.length ? percentage(done / chapters.length) : 0};
}

export function MiniCourseCard({course, chapters, selected, onOpen}: {
  course: Course; chapters: Chapter[]; selected: boolean; onOpen: () => void;
}) {
  const {done, total, percent} = progress(chapters);
  return <button className={'mini-course ' + (selected ? 'selected' : '')} style={courseTheme(course)}
    aria-current={selected ? 'page' : undefined} title={course.title} onClick={onOpen}>
    <CourseIcon course={course} size={18}/>
    <span className="mini-course-body">
      <strong>{course.title}</strong>
      <span className="mini-course-meta">已复习 {done} / {total}<b>{percent}%</b></span>
      <span className="mini-progress" aria-hidden="true"><i style={{width: percent + '%'}}/></span>
    </span>
  </button>;
}

export function CourseCard({course, chapters, onOpen}: {course: Course; chapters: Chapter[]; onOpen: () => void}) {
  const {done, total, percent} = progress(chapters);
  const last = [...chapters].filter(c => c.lastRead).sort((a,b) => b.lastRead!.localeCompare(a.lastRead!))[0];
  return <article className="course-card" style={courseTheme(course)}>
    <div className="course-cover">
      <div className="card-top"><CourseIcon course={course} size={28}/><span className="tag">{total} 个章节</span></div>
      <button className="course-title" title={course.title} onClick={onOpen}>{course.title}</button>
      <p title={course.description}>{course.description}</p>
    </div>
    <div className="course-card-body">
      <div className="progress-label"><span>已复习 <b>{done}</b> / {total}</span><strong>{percent}<small>%</small></strong></div>
      <div className="progress-track" aria-label={`已复习 ${percent}%`}><i style={{width: percent + '%'}}/></div>
      <div className="card-foot"><span><Clock3 size={12}/>{last ? '上次阅读 ' + new Date(last.lastRead!).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric'}) : '等待你的第一次探索'}</span>
        <button className="course-open" title={`打开${course.title}`} onClick={onOpen}>进入课程<ArrowRight size={14}/></button>
      </div>
    </div>
  </article>;
}

export function ChapterNavCard({chapter, index, active, today, onOpen}: {
  chapter: Chapter; index: number; active: boolean; today: string; onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Scroll only the directory; scrollIntoView would also move outer page containers.
  useEffect(() => {
    if (!active || !ref.current) return;
    const card = ref.current, list = card.parentElement!;
    const c = card.getBoundingClientRect(), p = list.getBoundingClientRect();
    if (c.top < p.top + 8) list.scrollTop -= p.top + 8 - c.top;
    else if (c.bottom > p.bottom - 8) list.scrollTop += c.bottom - p.bottom + 8;
  }, [active]);
  const due = !!chapter.dueDate && chapter.dueDate <= today;
  const read = percentage(chapter.progress);
  return <button ref={ref} className={'chapter-nav-item ' + (active ? 'active ' : '') + (chapter.reviews ? 'reviewed' : '')}
    aria-current={active ? 'step' : undefined} title={chapter.title} onClick={onOpen}>
    <span className="chapter-card-heading"><span className="chapter-number">{String(index + 1).padStart(2, '0')}</span>
      <span className={'chapter-review-state ' + (chapter.reviews ? 'done' : '')}>{chapter.reviews ? <><Check size={11}/>已复习</> : '未复习'}</span>
      {due && <span className="chapter-due">{chapter.dueDate! < today ? '逾期' : '待复习'}</span>}
    </span>
    <strong className="chapter-card-title">{chapter.title}</strong>
    <span className="chapter-reading"><span>{active ? '正在阅读' : chapter.lastRead ? '阅读进度' : '尚未阅读'}</span><b>{read}%</b></span>
    <span className="chapter-progress" aria-hidden="true"><i style={{width:read + '%'}}/></span>
  </button>;
}

export function ChapterRow({chapter: c, course, withCourse, today, onOpen, onReview}: {
  chapter: Chapter; course: Course; withCourse: boolean; today: string; onOpen: () => void; onReview: () => void;
}) {
  const isDue = !!c.dueDate && c.dueDate <= today;
  return <div className={'chapter-row ' + (isDue ? 'is-due' : '')} style={courseTheme(course)}>
    <span className={'chapter-status ' + (c.reviews ? 'done' : '')} title={c.reviews ? '已完成复习' : '尚未复习'}>
      {c.reviews ? <Check size={18}/> : String(c.order + 1).padStart(2,'0')}
    </span>
    <button className="row-title" title={c.title} onClick={onOpen}><strong>{c.title}</strong>
      <small>{withCourse && <>{course.title}<span className="meta-separator">·</span></>}阅读 {percentage(c.progress)}%<span className="meta-separator">·</span>{c.reviews ? `${c.reviews} 次复习` : '尚未复习'}</small>
    </button>
    {c.rating && <span className="rating-tag" style={{color:ratings[c.rating].color, background:ratings[c.rating].color+'12'}}>{ratings[c.rating].label}</span>}
    <span className={'due-label ' + (isDue ? 'overdue' : '')}>{c.dueDate ? (c.dueDate === today ? '今天复习' : c.dueDate < today ? '已到期 · '+c.dueDate.slice(5) : c.dueDate.slice(5)+' 复习') : '待安排'}</span>
    <button className="text-button row-read" onClick={onOpen}>阅读<ArrowRight size={14}/></button>
    <button className="icon-button" title="记录复习或修改计划" onClick={onReview}><CalendarClock size={18}/></button>
  </div>;
}

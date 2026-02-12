import { gsap } from 'gsap';
import { Film, ImageIcon } from 'lucide-react';
import { useEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';

import './ChromaGrid.css';

export interface ChromaGridItem {
  id: string | number;
  mediaUrl?: string;
  mediaType: 'image' | 'video';
  title: string;
  subtitle?: string;
  handle?: string;
  borderColor?: string;
  gradient?: string;
  onClick?: () => void;
}

interface ChromaGridProps {
  items: ChromaGridItem[];
  className?: string;
  radius?: number;
  damping?: number;
  fadeOut?: number;
  ease?: string;
}

export default function ChromaGrid({
  items,
  className = '',
  radius = 280,
  damping = 0.45,
  fadeOut = 0.6,
  ease = 'power3.out',
}: ChromaGridProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fadeRef = useRef<HTMLDivElement | null>(null);
  const setX = useRef<((value: number) => void) | null>(null);
  const setY = useRef<((value: number) => void) | null>(null);
  const pos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    setX.current = gsap.quickSetter(el, '--x', 'px') as (value: number) => void;
    setY.current = gsap.quickSetter(el, '--y', 'px') as (value: number) => void;

    const { width, height } = el.getBoundingClientRect();
    pos.current = { x: width / 2, y: height / 2 };
    setX.current?.(pos.current.x);
    setY.current?.(pos.current.y);
  }, []);

  const moveTo = (x: number, y: number) => {
    gsap.to(pos.current, {
      x,
      y,
      duration: damping,
      ease,
      onUpdate: () => {
        setX.current?.(pos.current.x);
        setY.current?.(pos.current.y);
      },
      overwrite: true,
    });
  };

  const handleMove = (event: PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    moveTo(event.clientX - rect.left, event.clientY - rect.top);
    gsap.to(fadeRef.current, { opacity: 0, duration: 0.25, overwrite: true });
  };

  const handleLeave = () => {
    gsap.to(fadeRef.current, {
      opacity: 1,
      duration: fadeOut,
      overwrite: true,
    });
  };

  const handleCardMove = (event: MouseEvent<HTMLElement>) => {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    card.style.setProperty('--mouse-x', `${x}px`);
    card.style.setProperty('--mouse-y', `${y}px`);
  };

  return (
    <div
      ref={rootRef}
      className={`chroma-grid ${className}`}
      style={{ '--r': `${radius}px` } as CSSProperties}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
    >
      {items.map((item) => (
        <article
          key={item.id}
          className="chroma-card"
          onMouseMove={handleCardMove}
          onClick={item.onClick}
          style={
            {
              '--card-border': item.borderColor || '#3b82f6',
              '--card-gradient': item.gradient || 'linear-gradient(145deg, #0d1b3d, #000)',
              cursor: item.onClick ? 'pointer' : 'default',
            } as CSSProperties
          }
        >
          <div className="chroma-img-wrapper">
            {item.mediaUrl ? (
              item.mediaType === 'video' ? (
                <video src={item.mediaUrl} muted playsInline preload="metadata" />
              ) : (
                <img src={item.mediaUrl} alt={item.title} loading="lazy" />
              )
            ) : (
              <div className="chroma-placeholder">
                {item.mediaType === 'video' ? <Film size={22} /> : <ImageIcon size={22} />}
                <span>{item.mediaType === 'video' ? 'VIDEO' : 'IMAGE'}</span>
              </div>
            )}
          </div>

          <footer className="chroma-info">
            <h3 className="name">{item.title}</h3>
            {item.handle ? <span className="handle">{item.handle}</span> : null}
            {item.subtitle ? <p className="role">{item.subtitle}</p> : null}
          </footer>
        </article>
      ))}

      <div className="chroma-overlay" />
      <div ref={fadeRef} className="chroma-fade" />
    </div>
  );
}

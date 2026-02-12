import { Film, ImageIcon } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { motion, useMotionValue, useSpring } from 'motion/react';

import './TiltedCard.css';

const springValues = {
  damping: 30,
  stiffness: 120,
  mass: 0.8,
};

type TiltedCardMediaType = 'image' | 'video';

interface TiltedCardProps {
  mediaSrc?: string;
  mediaType?: TiltedCardMediaType;
  altText?: string;
  captionText?: string;
  containerHeight?: string;
  containerWidth?: string;
  mediaHeight?: string;
  mediaWidth?: string;
  scaleOnHover?: number;
  rotateAmplitude?: number;
  showMobileWarning?: boolean;
  showTooltip?: boolean;
  overlayContent?: ReactNode;
  displayOverlayContent?: boolean;
  className?: string;
  onClick?: () => void;
}

export default function TiltedCard({
  mediaSrc,
  mediaType = 'image',
  altText = 'Tilted card media',
  captionText = '',
  containerHeight = '300px',
  containerWidth = '220px',
  mediaHeight = '300px',
  mediaWidth = '220px',
  scaleOnHover = 1.05,
  rotateAmplitude = 12,
  showMobileWarning = false,
  showTooltip = true,
  overlayContent = null,
  displayOverlayContent = false,
  className = '',
  onClick,
}: TiltedCardProps) {
  const ref = useRef<HTMLElement | null>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(0, springValues);
  const rotateY = useSpring(0, springValues);
  const scale = useSpring(1, springValues);
  const opacity = useSpring(0);
  const rotateFigcaption = useSpring(0, {
    stiffness: 320,
    damping: 28,
    mass: 0.7,
  });

  const [lastY, setLastY] = useState(0);

  const handleMouseMove = (event: MouseEvent<HTMLElement>) => {
    if (!ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - rect.width / 2;
    const offsetY = event.clientY - rect.top - rect.height / 2;

    const nextRotateX = (offsetY / (rect.height / 2)) * -rotateAmplitude;
    const nextRotateY = (offsetX / (rect.width / 2)) * rotateAmplitude;

    rotateX.set(nextRotateX);
    rotateY.set(nextRotateY);

    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);

    const velocityY = offsetY - lastY;
    rotateFigcaption.set(-velocityY * 0.4);
    setLastY(offsetY);
  };

  const handleMouseEnter = () => {
    scale.set(scaleOnHover);
    opacity.set(1);
  };

  const handleMouseLeave = () => {
    opacity.set(0);
    scale.set(1);
    rotateX.set(0);
    rotateY.set(0);
    rotateFigcaption.set(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <figure
      ref={ref}
      className={`tilted-card-figure ${className}`}
      style={{
        height: containerHeight,
        width: containerWidth,
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : -1}
    >
      {showMobileWarning ? (
        <div className="tilted-card-mobile-alert">This effect is best on desktop.</div>
      ) : null}

      <motion.div
        className="tilted-card-inner"
        style={{
          width: mediaWidth,
          height: mediaHeight,
          rotateX,
          rotateY,
          scale,
        }}
      >
        {mediaSrc ? (
          mediaType === 'video' ? (
            <video
              src={mediaSrc}
              className="tilted-card-media"
              style={{ width: mediaWidth, height: mediaHeight }}
              muted
              loop
              playsInline
              autoPlay
              preload="metadata"
            />
          ) : (
            <motion.img
              src={mediaSrc}
              alt={altText}
              className="tilted-card-media"
              style={{ width: mediaWidth, height: mediaHeight }}
              loading="lazy"
            />
          )
        ) : (
          <div className="tilted-card-placeholder" style={{ width: mediaWidth, height: mediaHeight }}>
            {mediaType === 'video' ? <Film size={24} /> : <ImageIcon size={24} />}
            <span>{mediaType === 'video' ? 'VIDEO' : 'IMAGE'}</span>
          </div>
        )}

        {displayOverlayContent && overlayContent ? (
          <motion.div className="tilted-card-overlay">{overlayContent}</motion.div>
        ) : null}
      </motion.div>

      {showTooltip && captionText ? (
        <motion.figcaption
          className="tilted-card-caption"
          style={{
            x,
            y,
            opacity,
            rotate: rotateFigcaption,
          }}
        >
          {captionText}
        </motion.figcaption>
      ) : null}
    </figure>
  );
}

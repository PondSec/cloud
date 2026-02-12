import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'motion/react';
import { useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';

import './ElasticSlider.css';

const MAX_OVERFLOW = 50;

type SliderRegion = 'left' | 'middle' | 'right';

interface ElasticSliderProps {
  value: number;
  onChange: (next: number) => void;
  minValue?: number;
  maxValue?: number;
  className?: string;
  isStepped?: boolean;
  stepSize?: number;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

function decay(value: number, max: number): number {
  if (max === 0) return 0;
  const entry = value / max;
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
  return sigmoid * max;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function ElasticSlider({
  value,
  onChange,
  minValue = 0,
  maxValue = 100,
  className = '',
  isStepped = false,
  stepSize = 1,
  leftIcon,
  rightIcon,
}: ElasticSliderProps) {
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const [region, setRegion] = useState<SliderRegion>('middle');
  const clientX = useMotionValue(0);
  const overflow = useMotionValue(0);
  const scale = useMotionValue(1);

  useMotionValueEvent(clientX, 'change', (latest) => {
    const slider = sliderRef.current;
    if (!slider) return;

    const { left, right } = slider.getBoundingClientRect();
    if (latest < left) {
      setRegion('left');
      overflow.jump(decay(left - latest, MAX_OVERFLOW));
      return;
    }
    if (latest > right) {
      setRegion('right');
      overflow.jump(decay(latest - right, MAX_OVERFLOW));
      return;
    }

    setRegion('middle');
    overflow.jump(0);
  });

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons === 0) return;

    const slider = sliderRef.current;
    if (!slider) return;

    const { left, width } = slider.getBoundingClientRect();
    const ratio = clamp((event.clientX - left) / width, 0, 1);
    let next = minValue + ratio * (maxValue - minValue);
    if (isStepped && stepSize > 0) {
      next = Math.round(next / stepSize) * stepSize;
    }
    onChange(clamp(next, minValue, maxValue));
    clientX.jump(event.clientX);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    handlePointerMove(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = () => {
    animate(overflow, 0, { type: 'spring', bounce: 0.5 });
  };

  const rangePercentage = useMemo(() => {
    const total = maxValue - minValue;
    if (total === 0) return 0;
    return ((value - minValue) / total) * 100;
  }, [maxValue, minValue, value]);

  const dynamicHeight = useTransform(scale, [1, 1.2], [6, 12]);
  const dynamicMarginTop = useTransform(scale, [1, 1.2], [0, -3]);
  const dynamicMarginBottom = useTransform(scale, [1, 1.2], [0, -3]);
  const dynamicOpacity = useTransform(scale, [1, 1.2], [0.78, 1]);
  const trackScaleX = useTransform(() => {
    const width = sliderRef.current?.getBoundingClientRect().width ?? 1;
    return 1 + overflow.get() / width;
  });
  const trackScaleY = useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.82]);
  const trackOrigin = useTransform(() => {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect) return 'center';
    return clientX.get() < rect.left + rect.width / 2 ? 'right' : 'left';
  });

  return (
    <div className={`elastic-slider-container ${className}`}>
      <motion.div
        onHoverStart={() => animate(scale, 1.2)}
        onHoverEnd={() => animate(scale, 1)}
        onTouchStart={() => animate(scale, 1.2)}
        onTouchEnd={() => animate(scale, 1)}
        style={{ scale, opacity: dynamicOpacity }}
        className="elastic-slider-wrapper"
      >
        <motion.div
          animate={{ scale: region === 'left' ? [1, 1.35, 1] : 1, transition: { duration: 0.25 } }}
          style={{ x: useTransform(() => (region === 'left' ? -overflow.get() / scale.get() : 0)) }}
          className="elastic-slider-icon"
        >
          {leftIcon}
        </motion.div>

        <div
          ref={sliderRef}
          className="elastic-slider-root"
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          <motion.div
            className="elastic-slider-track-wrapper"
            style={{
              scaleX: trackScaleX,
              scaleY: trackScaleY,
              transformOrigin: trackOrigin,
              height: dynamicHeight,
              marginTop: dynamicMarginTop,
              marginBottom: dynamicMarginBottom,
            }}
          >
            <div className="elastic-slider-track">
              <div className="elastic-slider-range" style={{ width: `${rangePercentage}%` }} />
            </div>
          </motion.div>
        </div>

        <motion.div
          animate={{ scale: region === 'right' ? [1, 1.35, 1] : 1, transition: { duration: 0.25 } }}
          style={{ x: useTransform(() => (region === 'right' ? overflow.get() / scale.get() : 0)) }}
          className="elastic-slider-icon"
        >
          {rightIcon}
        </motion.div>
      </motion.div>
    </div>
  );
}

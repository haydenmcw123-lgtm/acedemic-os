import type { CameraAngle } from "@/lib/types";

const BALL = { x: 168, y: 58 };
const CAMERA = {
  "down-the-line": { x: 36, y: 58, rotate: 0 },
  "face-on": { x: 168, y: 108, rotate: -90 },
} as const;

/**
 * Plan view — looking straight down at the hitting bay. Target is to the
 * right, the golfer stands above the ball, the camera is the one thing in
 * accent because it is the one thing people get wrong.
 */
export function AngleDiagram({ angle }: { angle: CameraAngle }) {
  const cam = CAMERA[angle];
  return (
    <svg
      viewBox="0 0 280 128"
      className="h-auto w-full"
      role="img"
      aria-label={
        angle === "down-the-line"
          ? "Plan view: camera behind the ball on the target line"
          : "Plan view: camera square to the golfer, perpendicular to the target line"
      }
    >
      {/* Target line */}
      <line
        x1={BALL.x}
        y1={BALL.y}
        x2={262}
        y2={BALL.y}
        stroke="rgba(244,243,238,0.5)"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      {/* Flag */}
      <line x1={262} y1={BALL.y} x2={262} y2={38} stroke="rgba(244,243,238,0.5)" strokeWidth="1" />
      <path d="M262 38 L274 43 L262 48 Z" fill="rgba(244,243,238,0.5)" />

      {/* Ball */}
      <circle cx={BALL.x} cy={BALL.y} r="3" fill="#F4F3EE" />

      {/* Golfer, from above: shoulders square to the target line */}
      <line
        x1={BALL.x - 16}
        y1={30}
        x2={BALL.x + 16}
        y2={30}
        stroke="rgba(244,243,238,0.7)"
        strokeWidth="1.5"
      />
      <circle cx={BALL.x} cy={30} r="5" fill="none" stroke="rgba(244,243,238,0.7)" strokeWidth="1.5" />
      <line
        x1={BALL.x}
        y1={35}
        x2={BALL.x}
        y2={BALL.y - 5}
        stroke="rgba(244,243,238,0.35)"
        strokeWidth="1"
      />

      {/* Camera + sight lines */}
      <g transform={`rotate(${cam.rotate} ${cam.x} ${cam.y})`}>
        <rect x={cam.x - 9} y={cam.y - 6} width="18" height="12" fill="#E8C547" />
        <path
          d={`M${cam.x + 9} ${cam.y} L${cam.x + 58} ${cam.y - 26} M${cam.x + 9} ${cam.y} L${cam.x + 58} ${cam.y + 26}`}
          stroke="#E8C547"
          strokeWidth="1"
          opacity="0.45"
        />
      </g>

      <text
        x={cam.x + (angle === "down-the-line" ? 0 : 0)}
        y={angle === "down-the-line" ? cam.y + 24 : cam.y + 20}
        textAnchor="middle"
        fill="#E8C547"
        fontSize="9"
        letterSpacing="1.6"
        fontFamily="var(--font-barlow-condensed)"
      >
        CAMERA
      </text>
      <text
        x={252}
        y={28}
        textAnchor="end"
        fill="rgba(244,243,238,0.45)"
        fontSize="9"
        letterSpacing="1.6"
        fontFamily="var(--font-barlow-condensed)"
      >
        TARGET
      </text>
    </svg>
  );
}

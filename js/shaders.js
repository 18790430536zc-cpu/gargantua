/* ============================================================
 * GARGANTUA — 着色器模块
 * 通道一：Schwarzschild 零测地线光线追踪（线性 HDR 输出）
 * 通道二：Bloom 合成 + ACES + 色散 + 颗粒 + 暗角
 *
 * 测地线方程（Schwarzschild 度规下零测地线的精确运动方程）：
 *     d²x/dλ² = -(3/2) · Rs · h² · x / |x|⁵
 * 其中 h = x × v 为守恒的比角动量。该方程在轨道平面内是严格的，
 * 光子球位于 r = 1.5 Rs，事件视界位于 r = Rs。
 * ============================================================ */

export const VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const TRACE_FRAG = /* glsl */ `
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uFov;

/* 21 项参数中进入本通道的部分 */
uniform float uMass;        // 史瓦西半径 Rs（场景归一化单位）
uniform float uDiskIn;      // 吸积盘内缘 / Rs
uniform float uDiskOut;     // 吸积盘外缘 / Rs
uniform float uDiskBright;  // 盘亮度
uniform float uDiskTemp;    // 盘温度（色相）
uniform float uTurb;        // 湍流强度
uniform float uSpeed;       // 轨道流速
uniform float uDoppler;     // Doppler 增亮强度
uniform float uRedshift;    // 引力红移强度
uniform float uRingBright;  // 光子环亮度
uniform float uRingSharp;   // 光子环锐度
uniform float uStarDens;    // 星空密度
uniform float uGalaxy;      // 银河亮度
uniform int   uSteps;       // 积分步数（质量档）
uniform int   uDebug;       // 调试视图 0-9

const int MAX_STEPS = 256;

/* ---------------- 噪声 ---------------- */
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, amp = 0.55;
  for (int i = 0; i < 5; i++) {
    v += amp * noise2(p);
    p = p * 2.13 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

/* ---------------- 程序化星空 + 银河 ---------------- */
vec3 starfield(vec3 dir) {
  vec3 col = vec3(0.0);
  vec3 bandN = normalize(vec3(0.35, 1.0, 0.25));
  float band = exp(-pow(abs(dot(dir, bandN)) * 3.0, 1.5));
  float wisps = fbm(vec2(atan(dir.z, dir.x) * 3.0, dir.y * 6.0) + 4.0);
  col += vec3(0.10, 0.12, 0.22) * band * (0.3 + 0.7 * wisps) * uGalaxy;
  col += vec3(0.18, 0.10, 0.07) * band * wisps * wisps * uGalaxy;
  // 银河暗尘裂隙
  float rift = smoothstep(0.55, 0.8, fbm(vec2(atan(dir.z, dir.x) * 5.0, dir.y * 9.0) + 13.0));
  col *= 1.0 - rift * band * 0.55;

  for (int layer = 0; layer < 3; layer++) {
    float scale = layer == 0 ? 70.0 : (layer == 1 ? 140.0 : 240.0);
    vec3 p = dir * scale;
    vec3 cell = floor(p);
    vec3 f3 = fract(p) - 0.5;
    float h = hash21(cell.xy + cell.z * 17.77 + float(layer) * 91.0);
    float thresh = 1.0 - 0.09 * uStarDens / float(layer + 1);
    if (h > thresh) {
      float bright = (h - thresh) / (1.0 - thresh);
      float d = length(f3);
      float star = smoothstep(0.30, 0.0, d) * bright * bright;
      float tint = hash21(cell.yz + cell.x * 31.1);
      vec3 starCol = mix(vec3(0.72, 0.80, 1.0), vec3(1.0, 0.82, 0.60), tint);
      float gain = layer == 0 ? 1.8 : (layer == 1 ? 0.9 : 0.45);
      col += starCol * star * gain;
    }
  }
  return col;
}

/* ---------------- 吸积盘 ---------------- */
vec3 diskColor(vec3 hit, vec3 rayDir, float r) {
  float rs = uMass;
  // 开普勒角速度 Ω ∝ r^(-3/2)
  float angVel = uSpeed * 0.9 * pow(r / rs, -1.5) / rs;
  float angle = atan(hit.z, hit.x) - uTime * angVel;

  vec2 uv = vec2(angle * 3.0, r * 2.4 / rs);
  float warp = fbm(uv * 1.7);
  float turb = fbm(uv + warp * (1.0 + uTurb));
  float streaks = 0.5 + 0.5 * sin(angle * 26.0 + turb * 16.0 * uTurb);
  streaks = pow(streaks, 1.6);

  float din = uDiskIn * rs, dout = uDiskOut * rs;
  float radial = smoothstep(din, din + 0.35 * rs, r)
               * (1.0 - smoothstep(din + 0.6 * rs, dout, r));
  radial = pow(radial, 1.5);

  float lane = fbm(vec2(angle * 1.6 + r * 0.8 / rs, r * 2.8 / rs) + 31.7);
  float midband = smoothstep(din + 0.4 * rs, din + 1.6 * rs, r)
                * (1.0 - smoothstep(din + 2.2 * rs, dout, r));
  float dust = smoothstep(0.52, 0.78, lane) * midband;

  // 温度色（uDiskTemp 整体偏移色相）
  float temp = (1.0 - smoothstep(din, dout, r)) * uDiskTemp;
  vec3 hot  = vec3(1.00, 0.92, 0.78);
  vec3 mid  = vec3(1.00, 0.58, 0.24);
  vec3 cool = vec3(0.45, 0.12, 0.05);
  vec3 base = mix(cool, mix(mid, hot, smoothstep(0.55, 1.0, temp)), smoothstep(0.0, 0.6, temp));

  // Doppler 集束 + 引力红移
  vec3 tangent = normalize(vec3(-hit.z, 0.0, hit.x));
  float dop = dot(tangent, -rayDir);
  float boost = pow(clamp(1.0 + dop * 0.6 * uDoppler, 0.10, 2.6), 3.2);
  vec3 dopTint = mix(vec3(1.0, 0.62, 0.42), vec3(0.85, 0.92, 1.15),
                     smoothstep(-0.8, 0.8, dop * uDoppler));
  float g = sqrt(max(1.0 - rs / max(r, rs * 1.01), 0.0));
  float redshift = pow(g, uRedshift);

  float I = radial * (0.35 + 0.65 * turb) * (0.55 + 0.45 * streaks);
  I *= 1.0 - dust * 0.72;
  return base * dopTint * I * boost * redshift * uDiskBright * 1.9;
}

/* ---------------- 主积分器 ---------------- */
void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  vec3 dir0 = normalize(uCamFwd + uFov * (uv.x * uCamRight + uv.y * uCamUp));
  vec3 pos = uCamPos;
  vec3 dir = dir0;

  float rs = uMass;
  // 守恒比角动量（每条光线计算一次）
  vec3 h = cross(pos, dir);
  float h2 = dot(h, h);

  vec3 col = vec3(0.0);
  vec3 diskAcc = vec3(0.0);
  float minR = 1e9;
  float transmittance = 1.0;
  int crossings = 0;
  bool captured = false;
  int stepsUsed = 0;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;
    stepsUsed = i;

    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    minR = min(minR, r);

    if (r < rs) { captured = true; break; }
    if (r > 30.0 * rs) break;

    // 自适应步长：越靠近视界越细
    float dt = clamp(0.15 * (r - rs * 0.85), 0.015 * rs, 0.30 * rs);

    // Schwarzschild 零测地线加速度：a = -(3/2) Rs h² x / r⁵
    float inv_r5 = 1.0 / (r2 * r2 * r);
    dir += pos * (-1.5 * rs * h2 * inv_r5) * dt;
    dir = normalize(dir);

    vec3 next = pos + dir * dt;

    // 吸积盘平面穿越（支持多次穿越：引力缠绕下可穿越 3 次以上）
    if (pos.y * next.y < 0.0 && crossings < 4) {
      float t = pos.y / (pos.y - next.y);
      vec3 hit = mix(pos, next, t);
      float hr = length(hit.xz);
      if (hr > uDiskIn * rs && hr < uDiskOut * rs) {
        vec3 dcol = diskColor(hit, dir, hr);
        float atten = crossings == 0 ? 1.0 : pow(0.82, float(crossings));
        diskAcc += dcol * atten * transmittance;
        transmittance *= 0.88;
        crossings++;
      }
      // 跳过盘面邻近区：防跨步漏检 / 防吸附（等价于 Ray-Plane 相交的鲁棒处理）
      if (abs(next.y) < 0.25 * dt) {
        next.y = next.y < 0.0 ? -0.25 * dt : 0.25 * dt;
      }
    }
    pos = next;
  }

  vec3 stars = captured ? vec3(0.0) : starfield(dir);
  col = stars + diskAcc;

  // 光子环：r ≈ 1.5 Rs 附近被无限拉伸的星光（细线，柔和衰减）
  float ring = exp(-pow((minR - rs * 1.02) * uRingSharp, 2.0));
  float halo = exp(-pow((minR - rs * 1.06) * 6.0, 2.0));
  // 亮度改为幂次压缩：低值区几乎不可见，高值区缓慢爬升，避免刺眼
  float ringI = pow(uRingBright * 0.5, 1.6);
  col += vec3(1.0, 0.97, 0.90) * ring * ringI * uDiskBright * 0.7;
  col += vec3(1.0, 0.80, 0.50) * halo * ringI * uDiskBright * 0.05;

  /* ---------------- 调试视图（0-9） ---------------- */
  if (uDebug == 1) {           // 积分步数热力图
    float s = float(stepsUsed) / float(uSteps);
    col = mix(vec3(0.0, 0.1, 0.4), vec3(1.0, 0.2, 0.0), s);
  } else if (uDebug == 2) {    // 最近接近距离
    col = vec3(clamp((minR - rs) / (4.0 * rs), 0.0, 1.0));
  } else if (uDebug == 3) {    // 盘面穿越次数
    col = vec3(float(crossings) / 4.0, float(crossings) * 0.15, 0.0);
  } else if (uDebug == 4) {    // 仅星空
    col = captured ? vec3(0.0) : starfield(dir);
  } else if (uDebug == 5) {    // 仅吸积盘
    col = diskAcc;
  } else if (uDebug == 6) {    // 光子环项
    col = vec3(ring) + vec3(halo) * 0.2;
  } else if (uDebug == 7) {    // 视界捕获掩码
    col = captured ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.15, 0.0);
  } else if (uDebug == 8) {    // 光线偏折角
    float defl = acos(clamp(dot(dir, dir0), -1.0, 1.0)) / 3.14159;
    col = vec3(defl);
  } else if (uDebug == 9) {    // 原始 HDR（对数）
    col = log(1.0 + col) * 0.5;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export const POST_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform vec2  uRes;
uniform float uTime;
uniform float uBloom;      // Bloom 强度
uniform float uBloomTh;    // Bloom 阈值
uniform float uExposure;   // 曝光
uniform float uGrain;      // 胶片颗粒
uniform float uChroma;     // 色散
uniform float uVignette;   // 暗角
uniform int   uDebug;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 centered = uv - 0.5;

  /* 轻微径向色散：RGB 三通道按不同放大率采样 */
  float ca = uChroma * 0.006 * dot(centered, centered) * 4.0;
  vec3 hdr;
  hdr.r = texture2D(tScene, uv + centered * ca).r;
  hdr.g = texture2D(tScene, uv).g;
  hdr.b = texture2D(tScene, uv - centered * ca).b;

  /* Bloom：黄金角螺旋 16 次亮部采样 */
  vec3 bloom = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float ang = fi * 2.39996;
    float rad = (fi + 1.0) / 16.0;
    vec2 off = vec2(cos(ang), sin(ang)) * rad * rad * 0.030;
    off.x *= uRes.y / uRes.x;
    float w = 1.0 - rad * 0.75;
    vec3 s = texture2D(tScene, uv + off).rgb;
    bloom += max(s - vec3(uBloomTh), vec3(0.0)) * w;
    wsum += w;
  }
  bloom /= wsum;
  vec3 col = hdr + bloom * 1.6 * uBloom;

  col = aces(col * uExposure);
  col = pow(col, vec3(0.92));

  /* 胶片颗粒 */
  float grain = hash21(uv * uRes + fract(uTime * 13.7) * 271.0) - 0.5;
  col += grain * uGrain * 0.05;

  /* 暗角 */
  col *= 1.0 - uVignette * (1.0 - pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.20));

  if (uDebug != 0) { col = hdr; }  // 调试视图直出，不做后期
  gl_FragColor = vec4(col, 1.0);
}
`;

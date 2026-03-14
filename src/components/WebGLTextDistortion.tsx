import { useEffect, useRef } from 'react'

export default function WebGLTextDistortion() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: 0, y: 0 })
  const mouseInsideRef = useRef(false)
  const specialTextPosRef = useRef({ x: 0, y: 0 })
  const timeRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl')
    if (!gl) {
      console.error('WebGL not supported')
      return
    }

    // Vertex shader source
    const vertexShaderSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;

      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `

    // Fragment shader source with distortion effect
    const fragmentShaderSource = `
      precision mediump float;

      uniform sampler2D u_texture;
      uniform vec2 u_mouse;
      uniform vec2 u_resolution;
      uniform vec2 u_specialTextPos;
      uniform bool u_mouseInside;
      uniform float u_scale;
      uniform float u_colorRadiusPixels;
      uniform float u_magnifyRadiusPixels;
      uniform float u_time;

      varying vec2 v_texCoord;

      // Simplified HSV to RGB for subtle iridescence
      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      // Enhanced scanlines effect with proper visibility
      float scanlines(vec2 coord) {
        float line = sin(coord.y * u_resolution.y * 1.5) * 0.15 + 0.85;
        return line;
      }

      // Added phosphor glow effect
      vec3 phosphorGlow(vec3 color, vec2 coord) {
        float glow = sin(coord.x * u_resolution.x * 3.0) * 0.02 + 0.98;
        return color * glow;
      }

      // Added vignette effect
      float vignette(vec2 coord) {
        vec2 center = coord - 0.5;
        float dist = length(center);
        return 1.0 - smoothstep(0.3, 0.8, dist);
      }

      // Added subtle noise
      float noise(vec2 coord) {
        return fract(sin(dot(coord, vec2(12.9898, 78.233)) + u_time * 0.001) * 43758.5453) * 0.03 + 0.97;
      }

      void main() {
        vec2 coord = v_texCoord;
        vec2 mouse = u_mouse / u_resolution;

        vec4 color = texture2D(u_texture, coord);

        // Only apply distortion if mouse is inside canvas
        if (u_mouseInside) {
          // Convert to pixel coordinates for dimension-independent calculations
          vec2 pixelCoord = coord * u_resolution;
          vec2 pixelMouse = u_mouse;
          vec2 pixelSpecialTextPos = u_specialTextPos * u_resolution;

          // Calculate distance in pixels
          float pixelDist = distance(pixelCoord, pixelMouse);

          // Use fixed pixel-based magnification radius
          if (pixelDist < u_magnifyRadiusPixels) {
            float factor = (u_magnifyRadiusPixels - pixelDist) / u_magnifyRadiusPixels;
            factor = smoothstep(0.0, 1.0, factor);

            // Scale texture coordinates toward mouse position for magnification
            vec2 direction = coord - mouse;
            coord = mouse + direction * (1.0 - factor * 0.5);

            vec4 distortedColor = texture2D(u_texture, coord);

            // Use pixel-based elliptical distance for color dispersion
            vec2 pixelDistortedCoord = coord * u_resolution;
            vec2 toSpecialTextPixels = pixelDistortedCoord - pixelSpecialTextPos;
            toSpecialTextPixels.y *= 2.5; // Fixed vertical constraint
            float ellipticalPixelDistance = length(toSpecialTextPixels);

            // Only apply iridescence using fixed pixel threshold
            if (ellipticalPixelDistance < u_colorRadiusPixels &&
                distortedColor.r > 0.3 && distortedColor.r < 0.9 && factor > 0.3) {

              // Calculate angle for color dispersion
              vec2 colorToSpecialTextPixels = pixelDistortedCoord - pixelSpecialTextPos;
              float angle = atan(colorToSpecialTextPixels.y, colorToSpecialTextPixels.x);
              float normalizedAngle = (angle + 3.14159) / (2.0 * 3.14159);

              float hue = normalizedAngle;
              vec3 iridescenceColor = hsv2rgb(vec3(hue, 1.0, 1.0));

              // Fixed intensity calculation
              float proximityFactor = 1.0 - (ellipticalPixelDistance / u_colorRadiusPixels);
              float iridescenceIntensity = proximityFactor * factor * 0.8;
              distortedColor.rgb = mix(distortedColor.rgb, iridescenceColor, iridescenceIntensity);
            }

            color = distortedColor;
          }
        }

        // Apply CRT effects without curvature
        color.rgb *= scanlines(v_texCoord);
        color.rgb = phosphorGlow(color.rgb, v_texCoord);
        color.rgb *= vignette(v_texCoord);
        color.rgb *= noise(v_texCoord);

        gl_FragColor = color;
      }
    `

    // Create shader function
    function createShader(gl: WebGLRenderingContext, type: number, source: string) {
      const shader = gl.createShader(type)
      if (!shader) return null

      gl.shaderSource(shader, source)
      gl.compileShader(shader)

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }

      return shader
    }

    // Create program function
    function createProgram(gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader) {
      const program = gl.createProgram()
      if (!program) return null

      gl.attachShader(program, vertexShader)
      gl.attachShader(program, fragmentShader)
      gl.linkProgram(program)

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program))
        gl.deleteProgram(program)
        return null
      }

      return program
    }

    // Create text texture
    function createTextTexture() {
      const textCanvas = document.createElement('canvas')
      const ctx = textCanvas.getContext('2d')
      if (!ctx) return null

      const viewportWidth = window.innerWidth
      const isDesktop = viewportWidth >= 768

      let targetWidth
      if (isDesktop) {
        targetWidth = Math.min(viewportWidth * 0.8, 1000)
      } else {
        targetWidth = viewportWidth - 40
      }

      ctx.font = '12px monospace'
      const actualCharWidth = ctx.measureText('неа ').width / 4 // 4 characters in "неа "

      const internalPadding = isDesktop ? 80 : 15
      const availableTextWidth = targetWidth - (internalPadding * 2)

      const baseCharsPerLine = Math.floor(availableTextWidth / actualCharWidth)
      const evenCharsPerLine = baseCharsPerLine % 2 === 0 ? baseCharsPerLine : baseCharsPerLine - 1
      const minCharsNeeded = 20
      const charsPerLine = Math.max(evenCharsPerLine, minCharsNeeded)

      const actualTextWidth = charsPerLine * actualCharWidth
      textCanvas.width = actualTextWidth + (internalPadding * 2)
      textCanvas.height = window.innerHeight

      ctx.fillStyle = '#000a00'
      ctx.fillRect(0, 0, textCanvas.width, textCanvas.height)

      ctx.fillStyle = '#1a6b1a'
      ctx.font = '12px monospace'

      const text = 'ok '
      const specialText = 'УЯЗВИМОСТЬ'
      const lineHeight = 16

      const horizontalOffset = internalPadding
      const availableHeight = textCanvas.height
      const linesCount = Math.floor(availableHeight / lineHeight)
      const reservedBottomLines = 4

      // Calculate exact number of "неа " blocks per line
      const nopesPerLine = Math.floor(charsPerLine / text.length)
      const standardLineLength = nopesPerLine * text.length

      let specialInserted = false
      const specialTextNormalizedPos = { x: 0, y: 0 }

      for (let lineIndex = 0; lineIndex < linesCount; lineIndex++) {
        const y = lineIndex * lineHeight
        let line = ''

        const isInSpecialTextZone = lineIndex > linesCount * 0.7 && lineIndex < linesCount - reservedBottomLines
        const isReservedBottomLine = lineIndex >= linesCount - reservedBottomLines

        if (!specialInserted && isInSpecialTextZone) {
          // Replace exactly 3 "неа " blocks to fit special text
          const nopesBeforeSpecial = nopesPerLine - 5 // Replace 3 nopes with special text, keep 2 after

          // Add nopes before special text
          for (let i = 0; i < nopesBeforeSpecial; i++) {
            line += text
          }

          // Add special text (replaces 3 nopes = 12 chars, specialText + space = 11 chars)
          line += specialText + ' '

          // Always 2 nopes after special text
          const remainingNopes = 2
          for (let i = 0; i < remainingNopes; i++) {
            line += text
          }

          // Fixed epicenter positioning to be consistent across screen sizes
          // Calculate position as percentage of line rather than fixed pixel offset
          const specialTextStartPos = nopesBeforeSpecial * text.length
          const etoPositionInSpecialText = 4 // "вот " is 4 characters, so "это" starts at position 4
          const totalCharPosition = specialTextStartPos + etoPositionInSpecialText + 1 // +1 to center on "это"

          // Normalize position relative to total line length for consistency
          specialTextNormalizedPos.x = (horizontalOffset + (totalCharPosition * actualCharWidth)) / textCanvas.width
          specialTextNormalizedPos.y = (y + lineHeight) / textCanvas.height
          specialInserted = true

        } else {
          // Regular lines: exactly nopesPerLine "неа " blocks
          for (let i = 0; i < nopesPerLine; i++) {
            line += text
          }
        }

        ctx.fillText(line, horizontalOffset, y + lineHeight)
      }

      // Fallback with same consistent pattern
      if (!specialInserted) {
        const fallbackLineIndex = linesCount - reservedBottomLines - 1
        const y = fallbackLineIndex * lineHeight

        // Updated fallback to also replace 3 nopes
        const nopesBeforeSpecial = nopesPerLine - 5
        let line = ''

        for (let i = 0; i < nopesBeforeSpecial; i++) {
          line += text
        }

        line += specialText + ' '

        // Always 2 nopes after special text
        const remainingNopes = 2
        for (let i = 0; i < remainingNopes; i++) {
          line += text
        }

        // Applied same consistent positioning logic to fallback
        const specialTextStartPos = nopesBeforeSpecial * text.length
        const etoPositionInSpecialText = 4
        const totalCharPosition = specialTextStartPos + etoPositionInSpecialText + 1

        specialTextNormalizedPos.x = (horizontalOffset + (totalCharPosition * actualCharWidth)) / textCanvas.width
        specialTextNormalizedPos.y = (y + lineHeight) / textCanvas.height

        ctx.fillStyle = '#000a00'
        ctx.fillRect(0, y, textCanvas.width, lineHeight)
        ctx.fillStyle = '#1a6b1a'
        ctx.fillText(line, horizontalOffset, y + lineHeight)
      }

      return { canvas: textCanvas, specialTextPos: specialTextNormalizedPos }
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)

    if (!vertexShader || !fragmentShader) return

    const program = createProgram(gl, vertexShader, fragmentShader)
    if (!program) return

    const positionLocation = gl.getAttribLocation(program, 'a_position')
    const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord')
    const textureLocation = gl.getUniformLocation(program, 'u_texture')
    const mouseLocation = gl.getUniformLocation(program, 'u_mouse')
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
    const specialTextPosLocation = gl.getUniformLocation(program, 'u_specialTextPos')
    const mouseInsideLocation = gl.getUniformLocation(program, 'u_mouseInside')
    const scaleLocation = gl.getUniformLocation(program, 'u_scale')
    const colorRadiusPixelsLocation = gl.getUniformLocation(program, 'u_colorRadiusPixels')
    const magnifyRadiusPixelsLocation = gl.getUniformLocation(program, 'u_magnifyRadiusPixels')
    const timeLocation = gl.getUniformLocation(program, 'u_time')

    const positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]), gl.STATIC_DRAW)

    const texCoordBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      1, 0,
    ]), gl.STATIC_DRAW)

    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)

    const textResult = createTextTexture()
    if (textResult) {
      specialTextPosRef.current = textResult.specialTextPos
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textResult.canvas)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    }

    function resizeCanvas() {
      const viewportWidth = window.innerWidth
      const isDesktop = viewportWidth >= 768

      let targetWidth
      if (isDesktop) {
        targetWidth = Math.min(viewportWidth * 0.8, 1000)
      } else {
        targetWidth = viewportWidth - 40
      }

      const tempCanvas = document.createElement('canvas')
      const tempCtx = tempCanvas.getContext('2d')
      if (!tempCtx) return

      tempCtx.font = '12px monospace'
      const actualCharWidth = tempCtx.measureText('неа ').width / 4

      const internalPadding = isDesktop ? 80 : 15
      const availableTextWidth = targetWidth - (internalPadding * 2)

      const baseCharsPerLine = Math.floor(availableTextWidth / actualCharWidth)
      const evenCharsPerLine = baseCharsPerLine % 2 === 0 ? baseCharsPerLine : baseCharsPerLine - 1
      const minCharsNeeded = 20
      const finalCharsPerLine = Math.max(evenCharsPerLine, minCharsNeeded)

      const actualCanvasWidth = (finalCharsPerLine * actualCharWidth) + (internalPadding * 2)

      canvas.width = actualCanvasWidth
      canvas.height = window.innerHeight

      canvas.style.width = actualCanvasWidth + 'px'
      canvas.style.height = canvas.height + 'px'

      gl.viewport(0, 0, canvas.width, canvas.height)

      const textResult = createTextTexture()
      if (textResult) {
        specialTextPosRef.current = textResult.specialTextPos
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textResult.canvas)
      }
    }

    function handleMouseMove(event: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current.x = event.clientX - rect.left
      mouseRef.current.y = event.clientY - rect.top
    }

    function handleMouseEnter() {
      mouseInsideRef.current = true
    }

    function handleMouseLeave() {
      mouseInsideRef.current = false
    }

    function handleTouchStart(event: TouchEvent) {
      event.preventDefault()
      mouseInsideRef.current = true
      const rect = canvas.getBoundingClientRect()
      const touch = event.touches[0]
      mouseRef.current.x = touch.clientX - rect.left
      mouseRef.current.y = touch.clientY - rect.top
    }

    function handleTouchMove(event: TouchEvent) {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const touch = event.touches[0]
      mouseRef.current.x = touch.clientX - rect.left
      mouseRef.current.y = touch.clientY - rect.top
    }

    function handleTouchEnd(event: TouchEvent) {
      event.preventDefault()
      mouseInsideRef.current = false
    }

    function render() {
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.useProgram(program)

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
      gl.enableVertexAttribArray(positionLocation)
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
      gl.enableVertexAttribArray(texCoordLocation)
      gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0)

      const viewportWidth = window.innerWidth
      const baseWidth = 768
      const scaleFactor = baseWidth / viewportWidth

      const isMobile = viewportWidth < 768
      const colorRadiusPixels = isMobile ? 220.0 : 180.0
      const magnifyRadiusPixels = 140.0

      gl.uniform1f(colorRadiusPixelsLocation, colorRadiusPixels)
      gl.uniform1f(magnifyRadiusPixelsLocation, magnifyRadiusPixels)

      gl.uniform1i(textureLocation, 0)
      gl.uniform2f(mouseLocation, mouseRef.current.x, mouseRef.current.y)
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height)
      gl.uniform2f(specialTextPosLocation, specialTextPosRef.current.x, specialTextPosRef.current.y)
      gl.uniform1i(mouseInsideLocation, mouseInsideRef.current ? 1 : 0)
      gl.uniform1f(scaleLocation, scaleFactor)
      gl.uniform1f(timeLocation, timeRef.current)

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      // Update time for animation
      timeRef.current += 16.67 // ~60fps
      requestAnimationFrame(render)
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseenter', handleMouseEnter)
    canvas.addEventListener('mouseleave', handleMouseLeave)
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false })

    // Removed fake center positioning and simplified race condition fix
    setTimeout(() => {
      const rect = canvas.getBoundingClientRect()

      // Use a global mouse position tracker without defaulting to center
      const globalMouseTracker = (e: MouseEvent) => {
        const globalMouseX = e.clientX
        const globalMouseY = e.clientY

        // Check if mouse is over canvas
        if (globalMouseX >= rect.left && globalMouseX <= rect.right &&
            globalMouseY >= rect.top && globalMouseY <= rect.bottom) {
          mouseInsideRef.current = true
          mouseRef.current.x = globalMouseX - rect.left
          mouseRef.current.y = globalMouseY - rect.top
        }

        document.removeEventListener('mousemove', globalMouseTracker)
      }

      // Only set up tracker, don't assume center position
      document.addEventListener('mousemove', globalMouseTracker, { once: true })
    }, 50)

    requestAnimationFrame(render)

    return () => {
      window.removeEventListener('resize', resizeCanvas)
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('mouseenter', handleMouseEnter)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
      canvas.removeEventListener('touchstart', handleTouchStart)
      canvas.removeEventListener('touchmove', handleTouchMove)
      canvas.removeEventListener('touchend', handleTouchEnd)
    }
  }, [])

  return (
    <div className="w-full min-h-screen overflow-x-hidden bg-[#000a00] flex flex-col items-center touch-none">
      {/* Header */}
      <div className="w-full flex justify-center py-6 z-10 relative">
        <div className="flex items-center gap-3">
          <span className="text-green-400 font-mono text-2xl font-bold tracking-widest">[SECAUDIT]</span>
          <span className="text-green-700 font-mono text-sm">v1.0.0</span>
        </div>
      </div>

      {/* WebGL canvas */}
      <div className="w-full flex justify-center px-0 touch-none" style={{ height: '100vh' }}>
        <canvas
          ref={canvasRef}
          className="border-0"
          style={{ display: 'block' }}
        />
      </div>

      {/* Subtitle below canvas */}
      <div className="w-full flex flex-col items-center py-12 gap-4 bg-[#000a00] z-10 relative">
        <p className="text-green-600 font-mono text-sm tracking-widest text-center px-4">
          НАВЕДИ КУРСОР — ОБНАРУЖИВАЙ УЯЗВИМОСТИ
        </p>
        <div className="flex gap-6 flex-wrap justify-center">
          <div className="flex flex-col items-center gap-1">
            <span className="text-green-400 font-mono text-xl font-bold">ПРАВА</span>
            <span className="text-green-800 font-mono text-xs">ДОСТУПА</span>
          </div>
          <div className="text-green-800 font-mono self-center">|</div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-green-400 font-mono text-xl font-bold">СЕТЬ</span>
            <span className="text-green-800 font-mono text-xs">АУДИТ</span>
          </div>
          <div className="text-green-800 font-mono self-center">|</div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-green-400 font-mono text-xl font-bold">ПАКЕТЫ</span>
            <span className="text-green-800 font-mono text-xs">АНАЛИЗ</span>
          </div>
        </div>

        {/* Audit blocks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl w-full px-6 mt-8">
          {[
            {
              title: 'ПРАВА ДОСТУПА',
              cmd: '$ find / -perm -4000 2>/dev/null',
              items: ['SUID-файлы', 'Мировая запись', 'SSH-ключи', '/etc/shadow'],
              status: 'АНАЛИЗ',
              color: 'border-green-800',
            },
            {
              title: 'СЕТЕВОЙ АУДИТ',
              cmd: '$ ss -tulnp | netstat -an',
              items: ['Открытые порты', 'Активные службы', 'Firewall правила', 'DNS утечки'],
              status: 'МОНИТОРИНГ',
              color: 'border-green-700',
            },
            {
              title: 'АУДИТ ПАКЕТОВ',
              cmd: '$ dpkg -l | apt list --upgradable',
              items: ['CVE уязвимости', 'Устаревшие пакеты', 'Orphan зависимости', 'Kernel версия'],
              status: 'СКАНИРОВАНИЕ',
              color: 'border-green-800',
            },
          ].map((block) => (
            <div
              key={block.title}
              className={`border ${block.color} bg-[#000d00] p-4 font-mono`}
            >
              <div className="flex justify-between items-center mb-3">
                <span className="text-green-400 text-xs font-bold tracking-wider">{block.title}</span>
                <span className="text-green-700 text-xs animate-pulse">{block.status}</span>
              </div>
              <div className="text-green-800 text-xs mb-3 truncate">{block.cmd}</div>
              <ul className="space-y-1">
                {block.items.map((item) => (
                  <li key={item} className="text-green-600 text-xs flex items-center gap-2">
                    <span className="text-green-800">›</span> {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button className="mt-8 border border-green-500 text-green-400 font-mono text-sm px-8 py-3 hover:bg-green-950 transition-colors tracking-widest">
          ЗАПУСТИТЬ АУДИТ
        </button>

        <p className="text-green-900 font-mono text-xs mt-4 text-center px-4">
          Python · Linux · Анализ прав / Сеть / Пакеты
        </p>
      </div>
    </div>
  )
}
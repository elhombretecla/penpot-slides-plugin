import type { UIMessage, PluginMessage, Slide, ExportSettings } from './types';

// Open the plugin UI at a comfortable size for a slide builder
penpot.ui.open('Slide Builder', `?theme=${penpot.theme}`, {
  width: 900,
  height: 680,
});

// ─── Message Handler ──────────────────────────────────────────────────────────

penpot.ui.onMessage<UIMessage>((message) => {
  switch (message.type) {
    case 'get-libraries':
      handleGetLibraries();
      break;
    case 'get-components':
      handleGetComponents(message.libraryId);
      break;
    case 'insert-into-canvas':
      handleInsertIntoCanvas(message.slides, message.settings);
      break;
    case 'resize':
      penpot.ui.resize(message.width, message.height);
      break;
  }
});

// ─── Theme Change ─────────────────────────────────────────────────────────────

penpot.on('themechange', (theme) => {
  const msg: PluginMessage = { type: 'theme', theme };
  penpot.ui.sendMessage(msg);
});

// ─── Library Handlers ─────────────────────────────────────────────────────────

function handleGetLibraries() {
  try {
    const local = penpot.library.local;
    const connected = penpot.library.connected;

    const libraries = [
      {
        id: local.id,
        name: `${local.name} (Local)`,
        numComponents: local.components.length,
      },
      ...connected.map((lib) => ({
        id: lib.id,
        name: lib.name,
        numComponents: lib.components.length,
      })),
    ];

    const msg: PluginMessage = { type: 'libraries', libraries };
    penpot.ui.sendMessage(msg);
  } catch (err) {
    sendError('Failed to load libraries: ' + String(err));
  }
}

function handleGetComponents(libraryId: string) {
  try {
    const allLibs = [penpot.library.local, ...penpot.library.connected];
    const lib = allLibs.find((l) => l.id === libraryId);

    if (!lib) {
      sendError(`Library not found: ${libraryId}`);
      return;
    }

    const components = lib.components.map((comp) => {
      let width: number | undefined;
      let height: number | undefined;
      try {
        const main = comp.mainInstance();
        if (main) {
          width = main.width;
          height = main.height;
        }
      } catch {
        // mainInstance may not be available in all contexts
      }
      return {
        id: comp.id,
        libraryId: comp.libraryId,
        name: comp.name,
        path: comp.path ?? '',
        width,
        height,
      };
    });

    const msg: PluginMessage = { type: 'components', libraryId, components };
    penpot.ui.sendMessage(msg);
  } catch (err) {
    sendError('Failed to load components: ' + String(err));
  }
}

// ─── Canvas Insertion ─────────────────────────────────────────────────────────

function handleInsertIntoCanvas(slides: Slide[], settings: ExportSettings) {
  try {
    let xOffset = penpot.viewport.center.x - (slides.length * (slides[0]?.width ?? 1280)) / 2;
    const yBase = penpot.viewport.center.y - (slides[0]?.height ?? 720) / 2;

    const insertedBoards: ReturnType<typeof penpot.createBoard>[] = [];

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const slideName = `${settings.slidePrefix} ${String(i + 1).padStart(2, '0')}`;

      if (slide.source === 'library-component' && slide.libraryId && slide.componentId) {
        // Insert component instance as slide
        const board = createBoardForSlide(slide, xOffset, yBase, slideName);
        try {
          const allLibs = [penpot.library.local, ...penpot.library.connected];
          const lib = allLibs.find((l) => l.id === slide.libraryId);
          const comp = lib?.components.find((c) => c.id === slide.componentId);
          if (comp) {
            const instance = comp.instance();
            instance.x = 0;
            instance.y = 0;
            board.appendChild(instance);
          }
        } catch {
          // If component instantiation fails, leave the board empty
        }
        insertedBoards.push(board);
      } else {
        // Build slide from our internal nodes
        const board = createBoardForSlide(slide, xOffset, yBase, slideName);
        populateBoardWithNodes(board, slide);
        insertedBoards.push(board);
      }

      xOffset += slide.width + settings.spacing;
    }

    // Optionally group all boards into a section
    if (settings.groupIntoSection && insertedBoards.length > 0) {
      try {
        // Select all inserted boards
        penpot.selection = insertedBoards;
      } catch {
        // Selection may not be available in all contexts
      }
    }

    const msg: PluginMessage = { type: 'insert-complete', count: insertedBoards.length };
    penpot.ui.sendMessage(msg);
  } catch (err) {
    sendError('Failed to insert slides: ' + String(err));
  }
}

function createBoardForSlide(
  slide: Slide,
  x: number,
  y: number,
  name: string
): ReturnType<typeof penpot.createBoard> {
  const board = penpot.createBoard();
  board.name = name;
  board.x = x;
  board.y = y;
  board.resize(slide.width, slide.height);
  board.clipContent = true;

  // Background fill - Fill interface uses fillColor/fillOpacity directly (no fillType)
  board.fills = [
    {
      fillColor: slide.background,
      fillOpacity: 1,
    },
  ];

  return board;
}

function populateBoardWithNodes(
  board: ReturnType<typeof penpot.createBoard>,
  slide: Slide
) {
  // Process in reverse order so visually "top" layers are actually on top in penpot
  for (const node of slide.nodes) {
    if (!node.visible) continue;

    try {
      if (node.type === 'text') {
        const text = penpot.createText(node.text ?? '');
        if (text) {
          text.name = node.name;
          text.x = node.x;
          text.y = node.y;
          text.resize(node.width, node.height);
          text.opacity = node.opacity;
          text.rotation = node.rotation;
          board.appendChild(text);
        }
      } else if (node.type === 'rect') {
        const rect = penpot.createRectangle();
        rect.name = node.name;
        rect.x = node.x;
        rect.y = node.y;
        rect.resize(node.width, node.height);
        rect.opacity = node.opacity;
        rect.rotation = node.rotation;

        rect.fills = [
          {
            fillColor: node.fill ?? '#ffffff',
            fillOpacity: node.fillOpacity ?? 1,
          },
        ];

        if (node.borderRadius) {
          rect.borderRadius = node.borderRadius;
        }

        if (node.strokeColor && node.strokeWidth) {
          rect.strokes = [
            {
              strokeStyle: 'solid',
              strokeColor: node.strokeColor,
              strokeOpacity: 1,
              strokeWidth: node.strokeWidth,
              strokeAlignment: 'center',
            },
          ];
        }

        board.appendChild(rect);
      } else if (node.type === 'ellipse') {
        const ellipse = penpot.createEllipse();
        ellipse.name = node.name;
        ellipse.x = node.x;
        ellipse.y = node.y;
        ellipse.resize(node.width, node.height);
        ellipse.opacity = node.opacity;
        ellipse.rotation = node.rotation;

        ellipse.fills = [
          {
            fillColor: node.fill ?? '#ffffff',
            fillOpacity: node.fillOpacity ?? 1,
          },
        ];

        if (node.strokeColor && node.strokeWidth) {
          ellipse.strokes = [
            {
              strokeStyle: 'solid',
              strokeColor: node.strokeColor,
              strokeOpacity: 1,
              strokeWidth: node.strokeWidth,
              strokeAlignment: 'center',
            },
          ];
        }

        board.appendChild(ellipse);
      } else if (node.type === 'component-instance') {
        const allLibs = [penpot.library.local, ...penpot.library.connected];
        const lib = allLibs.find((l) => l.id === node.libraryId);
        const comp = lib?.components.find((c) => c.id === node.componentId);
        if (comp) {
          const instance = comp.instance();
          instance.name = node.name;
          instance.x = node.x;
          instance.y = node.y;
          instance.resize(node.width, node.height);
          board.appendChild(instance);
        }
      }
    } catch {
      // Skip nodes that fail to create
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendError(message: string) {
  const msg: PluginMessage = { type: 'error', message };
  penpot.ui.sendMessage(msg);
}

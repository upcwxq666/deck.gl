// All utility mehtods needed to implement Marching Squres algorithm
// Ref: https://en.wikipedia.org/wiki/Marching_squares
import assert from 'assert';
import {log} from '@deck.gl/core';
import {ISOLINES_CODE_OFFSET_MAP, ISOBANDS_CODE_OFFSET_MAP} from './marching-squares-codes';

export const CONTOUR_TYPE = {
  ISO_LINES: 1,
  ISO_BANDS: 2
};

const Z_OFFSET = 0.002;

const DEFAULT_THRESHOLD_DATA = {
  zIndex: 0,
  zOffsetScale: 1
};

// Utility methods

function getVertexCode({weight, threshold}) {
  // threshold must be a single value or a range (array of size 2)
  assert(Number.isFinite(threshold) || (Array.isArray(threshold) && threshold.length > 1));

  // Iso-bands
  if (Array.isArray(threshold)) {
    if (weight < threshold[0]) {
      return 0;
    }
    return weight < threshold[1] ? 1 : 2;
  }
  // Iso-lines
  return weight >= threshold ? 1 : 0;
}

// Returns marching square code for given cell
/* eslint-disable complexity, max-statements*/
export function getCode(opts) {
  // Assumptions
  // Origin is on bottom-left , and X increase to right, Y to top
  // When processing one cell, we process 4 cells, by extending row to top and on column to right
  // to create a 2X2 cell grid
  const {cellWeights, x, y, width, height} = opts;
  let threshold = opts.threshold;
  if (opts.thresholdValue) {
    log.deprecated('thresholdValue', 'threshold')();
    threshold = opts.thresholdValue;
  }

  assert(x >= -1 && x < width);
  assert(y >= -1 && y < height);

  const isLeftBoundary = x < 0;
  const isRightBoundary = x >= width - 1;
  const isBottomBoundary = y < 0;
  const isTopBoundary = y >= height - 1;
  const isBoundary = isLeftBoundary || isRightBoundary || isBottomBoundary || isTopBoundary;

  const weights = {};
  const codes = {};

  // TOP
  if (isLeftBoundary || isTopBoundary) {
    codes.top = 0;
  } else {
    weights.top = cellWeights[(y + 1) * width + x];
    codes.top = getVertexCode({weight: weights.top, threshold});
  }

  // TOP-RIGHT
  if (isRightBoundary || isTopBoundary) {
    codes.topRight = 0;
  } else {
    weights.topRight = cellWeights[(y + 1) * width + x + 1];
    codes.topRight = getVertexCode({weight: weights.topRight, threshold});
  }

  // RIGHT
  if (isRightBoundary || isBottomBoundary) {
    codes.right = 0;
  } else {
    weights.right = cellWeights[y * width + x + 1];
    codes.right = getVertexCode({weight: weights.right, threshold});
  }

  // CURRENT
  if (isLeftBoundary || isBottomBoundary) {
    codes.current = 0;
  } else {
    weights.current = cellWeights[y * width + x];
    codes.current = getVertexCode({weight: weights.current, threshold});
  }

  const {top, topRight, right, current} = codes;
  let code = -1;
  if (Number.isFinite(threshold)) {
    code = (top << 3) | (topRight << 2) | (right << 1) | current;
  }
  if (Array.isArray(threshold)) {
    code = (top << 6) | (topRight << 4) | (right << 2) | current;
  }
  assert(code >= 0);

  let meanCode = 0;
  // meanCode is only needed for saddle cases, and they should
  // only occur when we are not processing a cell on boundary
  // because when on a boundary either, bottom-row, top-row, left-column or right-column will have both 0 codes
  if (!isBoundary) {
    assert(
      Number.isFinite(weights.top) &&
        Number.isFinite(weights.topRight) &&
        Number.isFinite(weights.right) &&
        Number.isFinite(weights.current)
    );
    meanCode = getVertexCode({
      weight: (weights.top + weights.topRight + weights.right + weights.current) / 4,
      threshold
    });
  }
  return {code, meanCode};
}
/* eslint-enable complexity, max-statements*/

// Returns intersection vertices for given cellindex
// [x, y] refers current marchng cell, reference vertex is always top-right corner
export function getVertices(opts) {
  const {gridOrigin, cellSize, x, y, code, meanCode, type = CONTOUR_TYPE.ISO_LINES} = opts;
  const thresholdData = Object.assign({}, DEFAULT_THRESHOLD_DATA, opts.thresholdData);
  let offsets;

  switch (type) {
    case CONTOUR_TYPE.ISO_LINES:
      offsets = ISOLINES_CODE_OFFSET_MAP[code];
      break;
    case CONTOUR_TYPE.ISO_BANDS:
      offsets = ISOBANDS_CODE_OFFSET_MAP[code];
      break;
    default:
      assert(false);
  }

  assert(offsets);
  // handle saddle cases
  if (!Array.isArray(offsets)) {
    offsets = offsets[meanCode];
  }

  assert(Array.isArray(offsets));
  // console.log(`offsets: ${offsets}`);
  // Reference vertex is at top-right move to top-right corner
  assert(x >= -1);
  assert(y >= -1);

  const vZ = thresholdData.zIndex * Z_OFFSET * thresholdData.zOffsetScale;
  const rX = (x + 1) * cellSize[0];
  const rY = (y + 1) * cellSize[1];

  const refVertexX = gridOrigin[0] + rX;
  const refVertexY = gridOrigin[1] + rY;

  // offsets format
  // ISO_LINES: [[1A, 1B], [2A, 2B]],
  // ISO_BANDS: [[1A, 1B, 1C, ...], [2A, 2B, 2C, ...]],

  // vertices format

  // ISO_LINES: [[x1A, y1A], [x1B, y1B], [x2A, x2B], ...],

  // ISO_BANDS:  => confirms to SolidPolygonLayer's simple polygon format
  //      [
  //        [[x1A, y1A], [x1B, y1B], [x1C, y1C] ... ],
  //        ...
  //      ]

  let results;
  switch (type) {
    case CONTOUR_TYPE.ISO_LINES:
      const vertices = [];
      offsets.forEach(xyOffsets => {
        xyOffsets.forEach(offset => {
          const vX = refVertexX + offset[0] * cellSize[0];
          const vY = refVertexY + offset[1] * cellSize[1];
          vertices.push([vX, vY, vZ]);
        });
      });
      results = vertices;
      break;
    case CONTOUR_TYPE.ISO_BANDS:
      const polygons = [];
      offsets.forEach(polygonOffsets => {
        const polygon = [];
        polygonOffsets.forEach(xyOffset => {
          const vX = refVertexX + xyOffset[0] * cellSize[0];
          const vY = refVertexY + xyOffset[1] * cellSize[1];
          polygon.push([vX, vY, vZ]);
        });
        polygons.push(polygon);
      });
      results = polygons;
      break;
    default:
      assert(false);
      break;
  }

  return results;
}

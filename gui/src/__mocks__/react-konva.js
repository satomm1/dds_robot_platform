// Automatic Jest mock: Konva needs the native `canvas` package under Node, so tests render
// each Konva node as a plain <div data-konva="..."> that keeps its children.
const React = require('react');

const make = (name) => {
  const Node = React.forwardRef(({ children }, ref) => (
    <div data-konva={name} ref={ref}>
      {children}
    </div>
  ));
  Node.displayName = name;
  return Node;
};

module.exports = {
  Stage: make('Stage'),
  Layer: make('Layer'),
  Rect: make('Rect'),
  Circle: make('Circle'),
  Line: make('Line'),
  Arrow: make('Arrow'),
  Text: make('Text'),
  Label: make('Label'),
  Tag: make('Tag'),
  Image: make('Image'),
  Shape: make('Shape'),
};

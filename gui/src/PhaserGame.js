import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';

const PhaserGame = ({ occupancyGrid, width, height, resolution, robotPositions, robotGoals, robotPaths, objectPositions }) => {
    const gameRef = useRef(null);
    const robotSpritesRef = useRef({});
    const robotGoalsRef = useRef({});
    const robotPathsRef = useRef({});
    const objectSpritesRef = useRef({});

    useEffect(() => {
        const maxGameSize = 800;
        const mapResolution = resolution;
        let gameWidth, gameHeight, gameCellSize;

        if (width > height) {
            gameWidth = maxGameSize;
            gameHeight = Math.floor(gameWidth * (height / width));
            gameCellSize = gameWidth / width;
        } else {
            gameHeight = maxGameSize;
            gameWidth = Math.floor(gameHeight * (width / height));
            gameCellSize = gameHeight / height;
        }

        const config = {
            type: Phaser.AUTO,
            width: gameWidth , // Multiply width by cell size
            height: gameHeight, // Multiply height by cell size
            parent: gameRef.current,
            scene: {
            preload,
            create
            }
        };

        gameRef.current = new Phaser.Game(config);

        function preload() {
            // Preload assets if necessary
            this.load.image('robot', '/assets/robot_sprite.png')
            this.load.image('goal', '/assets/goal_sprite.png')
            this.load.image('object', '/assets/object_sprite.png')
        }

        function create() {
            const cellSize = gameCellSize;
            const textStyle = { font: '16px Arial', fill: '0x000000'};
            const gridLineColor = 0xcccccc;
            const graphics = this.add.graphics();

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const index = y * width + x;
                    const value = occupancyGrid[index];
                    let color;

                    if (value === 100) {
                        color = 0x000000; // Red for occupied
                    } else if (value === 0) {
                        color = 0xE4F8FF; // Green for free
                    } else {
                        color = 0xA8A8A8; // Blue for unknown
                    }


                    graphics.fillStyle(color, 1.0);
                    graphics.fillRect((width - x-1) * cellSize, y * cellSize, cellSize, cellSize);

                    // this.add.rectangle(
                    //     (width - x-1) * cellSize,
                    //     y * cellSize,
                    //     cellSize,
                    //     cellSize,
                    //     color
                    // ).setOrigin(0, 0);
                }
            }

            for (let y = 0; y < height*mapResolution; y++) {
                if (height * mapResolution > 10) {
                    if (y % 2) {
                        this.add.text(0, y * cellSize/mapResolution, y, textStyle).setOrigin(0, 0);
                    }
                } else {
                    this.add.text(0, y * cellSize/mapResolution, y, textStyle).setOrigin(0, 0);
                }
                
                this.add.line(0, 0, 0, y * cellSize/mapResolution, gameWidth*2, y * cellSize/mapResolution, gridLineColor)
            }

            for (let x = 0; x < width*mapResolution; x++) {
                if (width * mapResolution > 10) {
                    if (x % 2) {
                        this.add.text((width*mapResolution - x)* cellSize/mapResolution-10, 0, x, textStyle).setOrigin(0, 0);
                    }
                } else {
                    this.add.text((width*mapResolution - x)* cellSize/mapResolution-10, 0, x, textStyle).setOrigin(0, 0);
                }
                this.add.line(0, 0,  (width*mapResolution - x-1)*cellSize/mapResolution, 0, (width*mapResolution - x-1)* cellSize/mapResolution, gameHeight*2, gridLineColor)
            }
        }

        return () => {
            gameRef.current.destroy(true);
        };
    }, [occupancyGrid, width, height, resolution]);

    useEffect(() => {
        if (gameRef.current && gameRef.current.scene && gameRef.current.scene.scenes[0]) {
            const scene = gameRef.current.scene.scenes[0];
            const cellSize = gameRef.current.config.width / width;

            robotGoals.forEach(robot => {
                const container = robotGoalsRef.current[robot.id];
                if (container) {
                    container.x = (width*resolution -robot.x_goal) * cellSize / resolution;
                    container.y = robot.y_goal * cellSize / resolution;
                    if (container.first) {
                        container.first.setRotation(3.14-robot.theta_goal); // Rotate the sprite, assuming it's the first child
                    }
                } else {
                    const container = scene.add.container((width*resolution -robot.x_goal) * cellSize / resolution, robot.y_goal * cellSize / resolution);

                    const sprite = scene.add.sprite(0, 0, 'goal');
                    if (robot.theta_goal) {
                        sprite.setRotation(3.14-robot.theta_goal);
                    }
                    sprite.setDisplaySize(30, 30);

                    const label = scene.add.text(0, 0, robot.id, { font: '16px Arial', fill: '#ffffff' });
                    label.setOrigin(0.5, 0.5); // Center the text on the sprite

                    container.add(sprite);
                    container.add(label);

                    robotGoalsRef.current[robot.id] = container;
                }
            });

            robotPositions.forEach(robot => {
                const container = robotSpritesRef.current[robot.id];
                if (container) {
                    container.x = (width*resolution -robot.x)* cellSize / resolution;
                    container.y = robot.y * cellSize / resolution;
                    if (container.first) {
                        container.first.setRotation(3.14 - robot.theta); // Rotate the sprite, assuming it's the first child
                    }
                } else {
                    const container = scene.add.container((width*resolution -robot.x )* cellSize / resolution, robot.y * cellSize / resolution);

                    const sprite = scene.add.sprite(0, 0, 'robot');
                    if (robot.theta) {
                        sprite.setRotation(3.14 - robot.theta);
                    }
                    sprite.setDisplaySize(30, 30);

                    const label = scene.add.text(0, 0, robot.id, { font: '16px Arial', fill: '#ffffff' });
                    label.setOrigin(0.5, 0.5); // Center the text on the sprite

                    container.add(sprite);
                    container.add(label);

                    robotSpritesRef.current[robot.id] = container;
                }
                
            });

            robotPaths.forEach(robot => {
                const path = robotPathsRef.current[robot.id];
                if (path) {
                    path.destroy();
                }

                const robotGoal = robotGoals.find(goal => goal.id === robot.id);
                const robotPosition = robotPositions.find(position => position.id === robot.id);
                if (Math.hypot(robotGoal.x_goal - robotPosition.x, robotGoal.y_goal - robotPosition.y) > 0.25) {
                    const graphics = scene.add.graphics();
                    graphics.lineStyle(2, 0x0000FF, 1);
                    graphics.beginPath();
                    graphics.moveTo((width*resolution -robot.x[0]) * cellSize / resolution, robot.y[0] * cellSize / resolution);

                    const pathLength = robot.x.length;
                    for (let i = 1; i < pathLength; i++) {
                        graphics.lineTo((width*resolution -robot.x[i]) * cellSize / resolution, robot.y[i] * cellSize / resolution);
                    }

                    // graphics.closePath();
                    graphics.strokePath();

                    robotPathsRef.current[robot.id] = graphics;
                }

                
                // } else {
                //     robotPathsRef.current[robot.id] = null;
                // }
                
            });
            
            objectPositions.forEach(object => {
                const sprite = objectSpritesRef.current[object.id];
                if (sprite) {
                    sprite.x = (width*resolution -object.x) * cellSize / resolution;
                    sprite.y = object.y * cellSize / resolution;

                } else {
                    const container = scene.add.container((width*resolution -object.x )* cellSize / resolution, object.y * cellSize / resolution);

                    const sprite = scene.add.sprite(0, 0, 'object');
                    sprite.setDisplaySize(30, 30);

                    // const label = scene.add.text(0, 0, object.type, { font: '10px Arial', fill: '#ffffff' });
                    // label.setOrigin(0.5, 0.5); // Center the text on the sprite

                    container.add(sprite);
                    // container.add(label)

                    objectSpritesRef.current[object.id] = container;
                }
            });
        }
    }, [robotPositions, resolution, width, robotGoals, robotPaths, objectPositions]);

    return <div id="phaser-game" />;
};

export default PhaserGame;

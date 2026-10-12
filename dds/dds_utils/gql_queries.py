AGENTS_QUERY = """
                    query {
                        subscribed_agents {
                            id
                        }
                    }
               """

TRANSFORM_QUERY = """
                        query {
                            transform {
                                R
                                t
                                timestamp
                                model
                                src_points
                                dst_points
                                smooth
                            }
                        }
                    """

ROBOT_POSITION_QUERY = """
    query($robot_id: Int!) {
        robotPosition(robot_id: $robot_id) {
            x
            y
            theta
            position_timestamp
        }
    }
"""

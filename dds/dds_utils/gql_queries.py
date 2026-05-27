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

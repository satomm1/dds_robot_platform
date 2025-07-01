
class Header:
    def __init__(self):
        self.seq = 0
        self.stamp = Stamp()
        self.frame_id = ""


class Stamp:
    def __init__(self):
        self.sec = 0
        self.nsec = 0

class Origin:
    def __init__(self):
        self.position = Position()
        self.orientation = Quaternion()


class Position:
    def __init__(self):
        self.x = 0
        self.y = 0
        self.z = 0


class Quaternion:
    def __init__(self):
        self.x = 0
        self.y = 0
        self.z = 0
        self.w = 0

class MapMetaData:
    def __init__(self):
        self.map_load_time = Stamp()
        self.resolution = 0
        self.width = 0
        self.height = 0
        self.origin = Origin()

class OccupancyGrid:
    def __init__(self):
        self.header = Header()
        self.info = MapMetaData()
        self.data = []

def msg_to_dict(obj):
    if obj is None:
        return None
    if isinstance(obj, list):
        return [msg_to_dict(item) for item in obj]
    if isinstance(obj, dict):
        return {key: msg_to_dict(value) for key, value in obj.items()}
    if hasattr(obj, "__dict__"):
        return {key: msg_to_dict(value) for key, value in obj.__dict__.items()}
    return obj